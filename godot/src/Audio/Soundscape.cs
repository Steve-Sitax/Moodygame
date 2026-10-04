using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using static Scheldemist.Audio.Wa;

namespace Scheldemist.Audio;

/// <summary>A vehicle the world shows (world/traffic.ts info()): its sound follows it. Kind "dray" or "handcart"; State "go" rolls, anything else stands still.</summary>
public readonly record struct VehicleSound(string Kind, double X, double Z, string State);

/// <summary>A ship under way on the river (world/boats.ts moving()). Steam: it has an engine; otherwise it sails. Anchored: no engine, a deep blast now and then.</summary>
public sealed class MovingShip
{
    public string Id = "";
    public string Kind = "";
    public double X, Z, Heading, Speed;
    public bool Steam, Anchored;
}

/// <summary>Who speaks or sings: "m" or "f", and the age.</summary>
public readonly record struct VoiceOf(string Sex, double Age);

/// <summary>How a made sound sits in the world (Soundscape.Placed): full within Ref metres, dull towards Reach, silent past Max.</summary>
public sealed record PlacedOpts(double Ref, double Reach, double Max, double Rolloff = 1, double Wet = 0.3, double Occl = 1, double Gain = 1, bool Must = false);

/// <summary>A running event sound: move it (a procession) or stop it early.</summary>
public sealed class SoundHandle
{
    private readonly Action<double, double> move;
    private readonly Action stop;
    public SoundHandle(Action<double, double>? move = null, Action? stop = null)
    {
        this.move = move ?? ((_, _) => { });
        this.stop = stop ?? (() => { });
    }
    public void Move(double x, double z) => move(x, z);
    public void Stop() => stop();
}

/// <summary>
/// The game's sound (client/src/audio/soundscape.ts, the same public surface). Recorded sounds wherever the game has
/// them (assets/ATTRIBUTION.md, Samples.cs); made in code: the water and wind beds under the recordings, gas hiss,
/// the foghorn, the voices, the street trades, the events' cues, the town's small life.
///
/// Beds: water at the nearest quay edge, wind, crowd murmur (SetCrowdAround), rain (SetRain).
/// Positioned loops (emitters): bridges, pontoons, smithy, ships, taverns, markets, lamps.
/// Events: hour bells and carillon (SetClock), watch bells on the ships, foghorn, gulls, dogs, steam whistles,
/// cranes, cooper, pumps, carts in the fog, footsteps.
/// Day and night (SetClock): fewer street sounds at night, more water and wind.
///
/// The clock, the weather, the rain, Jef's steps, the people and the voices come from the other parts
/// (SoundWiring.cs). Options that hold their own: --hour 13.5, --weather rain, --rain 0..1.
/// </summary>
[GamePart(60)]
public partial class Soundscape : Godot.Node
{
    /// <summary>The running soundscape, for the parts that make sounds (the browser's `sound`).</summary>
    public static Soundscape? I { get; private set; }

    private static double Clamp01(double v) => Math.Max(0, Math.Min(1, v));
    private static double Ramp(double v, double a, double b) => Clamp01((v - a) / (b - a));
    private static double Hyp(double a, double b) => Math.Sqrt(a * a + b * b);
    private static bool Finite(double x, double z) => double.IsFinite(x) && double.IsFinite(z);

    /// <summary>How far sounds carry: fog dulls and softens everything far off. The foghorn only in fog. `seen`: metres you can see a cart in the street.</summary>
    private static readonly Dictionary<string, (double lp, double gain, double horn, double seen)> WeatherFar = new()
    {
        ["fog"] = (1300, 0.6, 1, 30),
        ["mist"] = (2300, 0.8, 0, 55),
        ["clear"] = (6000, 1, 0, 90),
        ["rain"] = (2000, 0.75, 0, 60),
        ["storm"] = (1600, 0.7, 0, 45),
    };
    /// <summary>Before the first SetWeather: a soft far bus and no foghorn.</summary>
    private static readonly (double lp, double gain, double horn, double seen) WeatherUnknown = (2300, 0.8, 0, 55);
    /// <summary>Where the bells are hung: loud at the tower's foot, fall off fast past the square, dull past 100 m; the houses take up to 4 dB more.</summary>
    private static readonly (double refM, double rolloff, double reach, double dull, double wet, double occl) Bell = (20, 1.5, 100, 1.5, 0.5, 0.4);
    /// <summary>At most this many positioned sounds at once; past it, new far one-shots are skipped.</summary>
    private const int SpotCap = 28;
    /// <summary>At most this many emitter loops, and this many vehicles, play at once: the nearest.</summary>
    private const int LoopCap = 12;
    private const int VehicleCap = 6;
    /// <summary>A steam whistle or a liner's blast is not heard past this (metres).</summary>
    private const double WhistleMax = 380;
    /// <summary>The tune and the strokes on the hour from 7:00 to 21:00, the short phrase on the half hour. The night is quiet.</summary>
    private const double BellFrom = 7, BellTo = 21;
    /// <summary>Foghorn level: peaks under -3 dBFS even from the pontoon.</summary>
    private const double FoghornGain = 0.8;
    /// <summary>Every horn or whistle keeps this far from the one before, in seconds.</summary>
    private static readonly double[] HornGap = { 40, 90 };

    /// <summary>Positioned loops by emitter kind: layers (sample, gain), audible radius, panner.</summary>
    private sealed record LoopDef((string name, double gain)[] Layers, double Radius, double Ref, double Rolloff, double Lowpass = 14000, double Wet = 0, double Reach = 150, double Occl = 1);

    /// <summary>Talk follows the people: 0 for one person, a little for two, full by about sixteen.</summary>
    private static double Chatter(double n) => n <= 1 ? 0 : Math.Min(1, Math.Sqrt((n - 1) / 15));
    /// <summary>A song wants a room: none below four people, full by ten.</summary>
    private static double Singing(double n) => Ramp(n, 3, 10);
    /// <summary>Two people this close (metres) can be talking to each other.</summary>
    private const double TalkM = 3;
    private static readonly HashSet<string> GroupCues = new() { "cheer", "laughter", "applause", "hymn", "murmur" };
    private static readonly HashSet<string> VoiceCues = new() { "shout", "cry" };
    private static readonly Dictionary<string, LoopDef> Loops = new()
    {
        // the water under a bridge or a pontoon is heard on it and beside it, not a street away
        ["bridge"] = new(new[] { ("waterBridge", 0.7) }, 7, 2, 2, Wet: 0.3),
        ["pontoon"] = new(new[] { ("waterPontoon", 1.1) }, 8, 2, 2, Wet: 0.2),
        ["smithy"] = new(new[] { ("anvil", 0.6) }, 80, 4, 1.1, Wet: 0.35),
        ["ship"] = new(new[] { ("shipCreak", 0.3) }, 30, 3, 1.4, Wet: 0.2),
        // a tavern's talk through its door is heard in front of it, not a street away
        ["tavern"] = new(new[] { ("tavernCrowd", 0.5), ("tavernSong", 0.55) }, 20, 3, 1.4, Lowpass: 750, Wet: 0.15),
        ["market"] = new(new[] { ("market", 0.6) }, 50, 6, 1.1, Wet: 0.2),
        ["lamp"] = new(new[] { ("hiss", 0.012) }, 12, 0.6, 2.2, Occl: 0),
    };
    /// <summary>A horse and cart: hooves on the setts and iron-shod wheels, on one panner; gone by 60 m.</summary>
    private static readonly LoopDef CartLoop = new(new[] { ("hooves", 0.9), ("wheels", 0.55) }, 60, 4, 1.2, Wet: 0.25);
    /// <summary>A handcart: just the wheels, smaller; gone by 40 m.</summary>
    private static readonly LoopDef HandcartLoop = new(new[] { ("wheels", 0.4) }, 40, 2.5, 1.2, Wet: 0.2);
    /// <summary>Engine and wheels of a steam ship: paddle kinds churn, screw kinds thump and wash.</summary>
    private static readonly LoopDef PaddleLoop = new(new[] { ("paddleWheels", 0.8), ("shipEngine", 0.3) }, 120, 6, 1, Lowpass: 6000, Wet: 0.3);
    private static readonly LoopDef ScrewLoop = new(new[] { ("shipEngine", 0.6), ("waterBridge", 0.35) }, 120, 6, 1, Lowpass: 6000, Wet: 0.3);
    private static bool IsTug(string k) => k.Contains("tug");
    private static bool IsPaddle(string k) => k.Contains("paddle");

    /// <summary>A running positioned loop (the browser's Voice): a place with a layer for each recording.</summary>
    private sealed class LoopVoice
    {
        public Spot Spot = null!;
        public readonly List<(string name, double baseGain, V v)> Layers = new();
    }
    private sealed class Live
    {
        public Emitter E = null!;
        public LoopVoice? Voice;
        public double Level;
    }
    private sealed class Cart
    {
        public double[][] Route = null!;
        public double[] Lens = null!;
        public double Total, S, Speed, X, Z, Level;
        public int Dir;
        public LoopVoice? Voice;
    }
    private sealed class ShipSound
    {
        public MovingShip Ship = null!;
        public LoopVoice? Voice;
        public double D = double.PositiveInfinity, Level, NextCall;
        public bool Approached;
    }

    // ------------------------------------------------------------------ state

    private double now;
    private readonly Stopwatch clockWatch = Stopwatch.StartNew();
    private Vector3 listenerPos;
    private string? roomKind;
    private readonly List<(string name, double baseGain, Spot spot)> roomBeds = new();
    private int? roomPeople;
    private readonly Dictionary<string, double> placePeople = new();
    private IReadOnlyList<Vector2> people = Array.Empty<Vector2>();
    private readonly List<(Spot spot, V v)> crowdSpots = new();
    private double quayDist;
    private Spot waterSpot = null!, windSpot = null!, windRecSpot = null!, murmurSpot = null!, rainRoofSpot = null!, rainCobbleSpot = null!;
    private Spot? downpourSpot;
    private (Spot gale, Spot rain, Spot inside)? stormBeds;
    private double tempest, tempestGust, tempestShelter;
    private (double gain, double lp) streetIn = (0.9, 20000);
    private double streetGain = 0.9, streetGainT = 0.9, streetLp = 20000, streetLpT = 20000, streetTau = 0.12;
    private double nextHorn, nextGull, nextLap, nextCreak, nextDog, nextWhistle, nextCrane, nextCooper, nextPump, nextCarriage, nextSlow, lastMove;
    public int HornCount { get; private set; }
    private readonly Dictionary<string, List<AudioStream>> steps = new() { ["stone"] = new(), ["wood"] = new() };
    private int lastStep = -1, lastSplash = -1;
    private readonly Dictionary<string, List<AudioStream>> fx = new();
    private readonly Dictionary<string, AudioStream> buf = new();
    private readonly List<string> failed = new();
    private List<Live> live = new();
    private List<Cart> carts = new();
    private readonly List<(VehicleSound v, LoopVoice? voice)> vehicles = new();
    private List<ShipSound> shipSounds = new();
    private double shipTickAt;
    private readonly Dictionary<string, double> greeted = new();
    private readonly HashSet<string> bedsStarted = new();
    private readonly List<Vector3> shipPositions = new();
    private (AudioStreamWav stream, double scale)? hissLoop, waterLoop, windLoop, downpourLoop, organLoop;
    private readonly List<(AudioStreamWav stream, double scale)> lapBank = new();
    private bool organOn, organWanted;
    private double organLevel = 1;
    private Spot? organSpot;
    private Spot? stepStone, stepWood, splashSoft, splashHard;

    // state set from outside
    private double? clock;
    private string? weather;
    private double hornOkAt, crowdN, rain;
    private bool smithyOn = true;
    private double smithyNext = 20; // at work when you arrive, then rests and works in turn
    /// <summary>Log of bells rung (dev checks).</summary>
    public readonly List<string> Rung = new();
    private readonly Dictionary<string, double> mixLevel = new() { ["music"] = 1, ["voices"] = 1, ["ambience"] = 1, ["effects"] = 1 };
    private readonly HashSet<string> warned = new();
    /// <summary>The river's level (world/tide.ts water.river; half tide until the tide part sets it): the lapping is down at the water.</summary>
    public double WaterLevel = -2.8;
    /// <summary>The beds and the loops at places play on their own; the self-test turns them off while it measures single sounds.</summary>
    public bool Auto = true;
    /// <summary>The chance sounds (foghorn, gulls, dogs, cranes ...) take their turns on their own.</summary>
    public bool Chance = true;
    // the cost of the sound part on the main thread (the budget: 0.3 ms a frame)
    private double costSum, costMax, costMaxAt, testMs;
    private int costN;

    /// <summary>Menus: the levels of music (the organ, ballads, a tavern's song), voices, the town's sounds, and Jef's own; 0..1 each.</summary>
    public void SetMix(IReadOnlyDictionary<string, double> levels)
    {
        foreach (var (k, v) in levels)
        {
            if (!mixLevel.ContainsKey(k)) continue;
            mixLevel[k] = v;
            AudioServer.SetBusVolumeDb(busIndex[Cap(k)], Db(v));
            AudioServer.SetBusVolumeDb(busIndex["Room" + Cap(k)], Db(v));
            if (k == "music") AudioServer.SetBusVolumeDb(busIndex["Organ"], Db(v));
        }
    }

    /// <summary>The last gain before the speakers (the browser's `speaker`): 0 plays to no speaker, and everything before it still runs.</summary>
    public double Speaker
    {
        get => AudioServer.IsBusMute(0) ? 0 : 1;
        set => AudioServer.SetBusMute(0, value <= 0);
    }

    public override void _Ready()
    {
        I = this;
        mixRate = (int)AudioServer.GetMixRate();
        MakeBuses();
        CacheBakedRooms();
        var sw = Stopwatch.StartNew();
        LoadAll();
        double loadMs = sw.Elapsed.TotalMilliseconds;

        // water bed: sits on the quay edge nearest the player (panner 4 m, rolloff 1.2)
        waterSpot = new Spot { Raw = true, Ref = 4, Rolloff = 1.2, Out = "Ambience", Hold = true, Level = 0.5, LevelT = 0.5, LevelTau = 0.8 };
        spots.Add(waterSpot);
        // wind bed, everywhere (made in code), and wind in the rigging (recorded)
        windSpot = Bed("Ambience", 0.3, 0.8);
        windRecSpot = Bed("Ambience", 0, 0.8);
        // crowd murmur: follows how many people are near (SetCrowdAround)
        murmurSpot = Bed("Murmur", 0, 1.5);
        murmurSpot.WetBase = murmurSpot.Wet = 0.15;
        murmurSpot.WetBus = "MurmurWet";
        // rain beds (SetRain)
        rainRoofSpot = Bed("Ambience", 0, 1.5);
        rainCobbleSpot = Bed("Ambience", 0, 1.5);
        StartBed("murmur", murmurSpot, 1);
        StartBed("windMasts", windRecSpot, 1);
        StartBed("waterWall", waterSpot, 0.55);

        // positioned loops and events; the ships' places for the wind in the rigging
        var list = Emitters.CityEmitters();
        SetEmitters(list);
        foreach (var e in list) if (e.Kind == "ship") shipPositions.Add(new Vector3((float)e.X, (float)(e.Y ?? 1), (float)e.Z));
        carts = Emitters.CartRoutes().Select((r, i) => MakeCart(r, i)).ToList();

        // the made beds: built once, off the main thread
        int rate = mixRate;
        Task.Run(() =>
        {
            try
            {
                // gas hiss: the white noise through a highpass (3 s, the noise's own loop)
                var hiss = RenderLoop(c => { var s = c.Noise(); s.Connect(c.Biquad("highpass", 3800, 0.4)).Connect(c.Destination); s.Start(0); return 0; }, rate, 3);
                // water: low brown rumble and a band of white, each with a slow swell (27 s: both swells come round)
                var water = RenderLoop(c => { LoopNoise(c, Brown, "lowpass", 380, 0.5, 0.13, 3 / 27.0); LoopNoise(c, White, "bandpass", 900, 0.8, 0.018, 6 / 27.0); return 0; }, rate, 27);
                var wind = RenderLoop(c => { LoopNoise(c, Brown, "lowpass", 180, 0.7, 0.06, 1 / 20.0); return 0; }, rate, 20);
                var laps = new List<(AudioStreamWav, double)>();
                for (int i = 0; i < 32; i++)
                {
                    var c = new Wa(rate);
                    double dur = Rand(0.18, 0.5);
                    Burst(c, c.Destination, 0, dur, "bandpass", Rand(250, 700), Rand(1.5, 4), 1, 0.35);
                    var w = ToWav(c.Render(dur + 0.03), rate);
                    if (w.stream != null) laps.Add((w.stream, w.scale));
                }
                ready.Enqueue(() =>
                {
                    hissLoop = hiss;
                    waterLoop = water;
                    windLoop = wind;
                    lapBank.AddRange(laps);
                    Add(waterSpot, water.stream, "water bed", water.scale, from: Rnd() * 20);
                    Add(windSpot, wind.stream, "wind bed", wind.scale, from: Rnd() * 15);
                });
                // the organ's chords too: they take a few seconds to build, and nobody should wait for them at the door
                var organ = ToWav(OrganSynth.RenderLoop(22050), 22050, true);
                ready.Enqueue(() =>
                {
                    organLoop ??= (organ.stream!, organ.scale);
                    if (organWanted && !organOn) Organ(true, organLevel);
                });
            }
            catch (Exception e)
            {
                GD.PrintErr($"[sound] the beds: {e}");
            }
        });

        now = 0;
        nextHorn = now + Rand(9, 16); // first one early, then 40-90 s
        nextGull = now + Rand(4, 10);
        nextCreak = now + Rand(3, 8);
        nextDog = now + Rand(20, 45);
        nextWhistle = now + Rand(60, 140);
        nextCrane = now + Rand(6, 15);
        nextCooper = now + Rand(5, 12);
        nextPump = now + Rand(10, 30);
        nextCarriage = now + Rand(30, 70);

        // the clock and the weather come from the game's state and the rain from the daylight (SoundWiring.cs); an
        // option holds its own: --hour 13.5, --weather rain, --rain 0..1
        string h = Main.I.Arg("hour");
        if (h != "" && double.TryParse(h, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out double hour))
        {
            ownHour = true;
            SetClock(hour);
        }
        string w = Main.I.Arg("weather");
        if (w != "")
        {
            ownWeather = true;
            SetWeather(w);
        }
        string r = Main.I.Arg("rain");
        if (r != "" && double.TryParse(r, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out double rn))
        {
            ownRain = true;
            SetRain(rn);
        }
        GD.Print($"sound in: {buf.Count} recordings, {steps["stone"].Count + steps["wood"].Count} steps, {live.Count} places, {failed.Count} failed, {unpacked} short ones unpacked, {loadMs:0} ms, mix {mixRate} Hz");
        if (Main.I.Arg("soundtest") != "") StartTest(Main.I.Arg("soundtest"));
    }

    private Spot Bed(string bus, double level, double tau)
    {
        var sp = FlatSpot(bus, hold: true);
        (sp.Level, sp.LevelT, sp.LevelTau) = (level, level, tau);
        return sp;
    }

    public override void _Process(double delta)
    {
        long t0 = Stopwatch.GetTimestamp();
        double before = now;
        now = clockWatch.Elapsed.TotalSeconds;
        double dt = Math.Min(0.25, now - before);
        while (ready.TryDequeue(out var fn)) fn();
        RunTimers();
        Wire();
        FollowState();
        TestPlaceCamera();
        if (Main.I.Cam != null && IsInstanceValid(Main.I.Cam)) Update(Main.I.Cam);
        TickStreet(dt);
        MixTick(dt);
        FeedHowl(dt);
        double ms = Stopwatch.GetElapsedTime(t0).TotalMilliseconds - testMs;
        testMs = 0;
        TestTick();
        testMs = 0;
        costSum += ms;
        if (ms > costMax) (costMax, costMaxAt) = (ms, now);
        costN++;
        test?.FrameCost(ms);
    }

    /// <summary>Godot's sound always runs: nothing to wake (the browser's audio context starts on a click).</summary>
    public void Resume() { }
    public string State => "running";

    /// <summary>Stop everything (the browser's dispose; a Godot node already has a Dispose of its own).</summary>
    public void Shutdown()
    {
        foreach (var sp in spots.ToArray()) DropSpot(sp);
        timers.Clear();
        howlPlayer?.Stop();
    }

    public override void _ExitTree()
    {
        Unwire();
        if (I == this) I = null;
    }

    // ------------------------------------------------------------------ rooms

    // echo s, decay, send, street lowpass Hz, street gain
    private static readonly Dictionary<string, double[]> Halls = new()
    {
        ["church"] = new[] { 4.8, 2.2, 0.62, 900, 0.5 },
        ["hall"] = new[] { 1.9, 3, 0.34, 480, 0.35 },
        ["vault"] = new[] { 1.6, 3, 0.36, 380, 0.3 },
        ["museum"] = new[] { 2.2, 2.8, 0.4, 420, 0.32 },
        ["store"] = new[] { 1.7, 3, 0.3, 460, 0.35 },
    };

    /// <summary>
    /// Interiors: inside a tavern or the Poesje's cellar the street is heard through the walls (low and dull), and
    /// the room has its own sound, close and clear: the tavern's crowd and song, the cellar's audience murmuring.
    /// A landmark has a hall of its own size ("church", "hall", "vault", "museum", "store"). null: back in the street.
    /// </summary>
    public void SetInterior(string? kind)
    {
        if (kind == roomKind) return;
        roomKind = kind;
        foreach (var b in roomBeds) FadeDrop(b.spot, 0.1, 0.4);
        roomBeds.Clear();
        // a new room starts quiet: its talk comes up as its people are counted (not the last room's)
        roomPeople = null;
        double[]? hall = kind != null && Halls.TryGetValue(kind, out var hh) ? hh : null;
        if (hall != null)
        {
            // the echo's length: where the browser's impulse (1 - k)^decay has fallen 60 dB
            double t60 = hall[0] * (1 - Math.Pow(10, -3 / hall[1]));
            double wet = hall[2] * ConvolverGain(hall[0]);
            SetVerb(hallVerb, t60, wet);
            SetVerb(organVerb, t60, wet * OrganEcho);
        }
        else
        {
            hallVerb.Wet = 0;
            organVerb.Wet = 0;
        }
        if (kind != "church") Organ(false);
        else PrepareOrgan();
        streetIn = (hall != null ? hall[4] : kind != null ? 0.4 : 0.9, hall != null ? hall[3] : kind != null ? 420 : 20000);
        (streetGainT, streetLpT, streetTau) = (streetIn.gain, streetIn.lp, 0.12);
        (string, double)[] beds = kind switch
        {
            "tavern" => new[] { ("tavernCrowd", 0.55), ("tavernSong", 0.32) },
            "cellar" => new[] { ("murmur", 0.3) },
            "church" => new[] { ("murmur", 0.05) },
            "hall" => new[] { ("murmur", 0.08) },
            _ => Array.Empty<(string, double)>(),
        };
        foreach (var (name, gain) in beds)
        {
            if (!buf.TryGetValue(name, out var b)) continue;
            var sp = FlatSpot(name == "tavernSong" ? "RoomMusic" : "RoomAmbience", hold: true);
            (sp.Level, sp.LevelT, sp.LevelTau) = (0, gain * RoomLevel(name), 0.25);
            Add(sp, b, "room " + name, 1, from: Rnd() * b.GetLength());
            roomBeds.Add((name, gain, sp));
        }
    }

    /// <summary>How loud a room bed is for the people in the room now: talk from two, a song from four and in the evening.</summary>
    private double RoomLevel(string name)
    {
        double n = roomPeople ?? 0;
        return name == "tavernSong" ? Singing(n) * SongHours() : Chatter(n);
    }

    /// <summary>Taverns sing from six in the evening to two at night.</summary>
    private double SongHours()
    {
        double h = HourNow;
        return h >= 18 ? Ramp(h, 18, 20) : h < 2 ? 1 - Ramp(h, 0.5, 2) : 0;
    }

    /// <summary>How many people are in the room Jef is in; null: none counted.</summary>
    public void SetRoomPeople(int? n) => roomPeople = n == null ? null : Math.Max(0, n.Value);

    /// <summary>How many people are in the building whose life runs now (a tavern's house id; null: none runs): the talk at its door follows.</summary>
    public void SetPlacePeople(string? id, double n)
    {
        if (id == null)
        {
            placePeople.Clear();
            return;
        }
        if (placePeople.Count > 1 || (placePeople.Count == 1 && !placePeople.ContainsKey(id))) placePeople.Clear();
        placePeople[id] = Math.Max(0, n);
    }

    private void PrepareOrgan()
    {
        if (organLoop != null || organRendering) return;
        organRendering = true;
        if (waterLoop == null) return; // (the start's own build is still at it, and brings the organ)
        Task.Run(() =>
        {
            try
            {
                // (22 kHz: the organ is all below 1.6 kHz)
                var w = ToWav(OrganSynth.RenderLoop(22050), 22050, true);
                ready.Enqueue(() =>
                {
                    organLoop = (w.stream!, w.scale);
                    if (organWanted) Organ(true, organLevel);
                });
            }
            catch (Exception e)
            {
                GD.PrintErr($"[sound] the organ: {e}");
            }
        });
    }
    private bool organRendering;

    /// <summary>The organ in the cathedral (a chord bed made in code), on or off.</summary>
    public void Organ(bool on, double level = 1)
    {
        organWanted = on;
        organLevel = level;
        if (!on && !organOn) return;
        if (on && organLoop == null)
        {
            PrepareOrgan();
            return;
        }
        if (on && !organOn)
        {
            organOn = true;
            if (organSpot != null) DropSpot(organSpot);
            organSpot = FlatSpot("Organ", hold: true);
            organSpot.Level = 0;
            Add(organSpot, organLoop!.Value.stream, "organ", organLoop.Value.scale);
        }
        else if (!on && organOn)
        {
            organOn = false;
            var sp = organSpot!;
            organSpot = null;
            After(2.5, () => DropSpot(sp));
            (sp.LevelT, sp.LevelTau) = (0, 0.6);
            return;
        }
        if (organSpot != null) (organSpot.LevelT, organSpot.LevelTau) = (on ? OrganSynth.BusGain * level : 0, on ? 1.2 : 0.6);
    }

    /// <summary>The small bell at the altar (the elevation).</summary>
    public void AltarBell()
    {
        var sp = FlatSpot("Organ");
        MadeAt(sp, OrganSynth.Bell, "altar bell");
    }

    /// <summary>Dev: is the organ playing?</summary>
    public bool OrganOn => organOn;

    /// <summary>Run `fn` with its one-shot sounds (steps, voices) in the room, not out in the street.</summary>
    public void Indoors(Action fn)
    {
        bool was = inRoom;
        inRoom = true;
        try
        {
            fn();
        }
        finally
        {
            inRoom = was;
        }
    }

    /// <summary>Dev: the room sound now.</summary>
    public string? Interior => roomKind;

    // ------------------------------------------------------------------ inputs

    /// <summary>
    /// The game clock. `hour` may carry fractions (7.25 = 7:15); `minute` adds to it. Crossing a full hour rings the
    /// carillon and strikes the hours from the cathedral; crossing a half hour plays a short carillon phrase and the
    /// watch bells on a ship near you. Jumps backwards or of more than two hours (sleep, a new day) ring nothing.
    /// </summary>
    public void SetClock(double hour, double minute = 0)
    {
        double t = hour + minute / 60;
        double? before = clock;
        clock = t;
        if (before == null) return;
        double dt = t - before.Value;
        if (dt <= 0 || dt > 2) return;
        int halfBefore = (int)Math.Floor(before.Value * 2);
        int halfNow = (int)Math.Floor(t * 2);
        if (halfNow == halfBefore) return;
        double at = halfNow / 2.0 % 24;
        if (at >= BellFrom && at <= BellTo)
        {
            if (halfNow % 2 == 0) HourBells(halfNow / 2);
            else Carillon(true);
        }
        WatchBells(halfNow % 8 == 0 ? 8 : halfNow % 8);
    }

    /// <summary>The day's weather ("fog", "mist", "clear", "rain", "storm"): fog dulls far sounds and the bells; the foghorn only sounds in fog.</summary>
    public void SetWeather(string w)
    {
        if (!WeatherFar.ContainsKey(w)) return; // unknown: keep what we had (at first: no foghorn)
        weather = w; // the positioned sounds follow on the next tick (TuneSpot)
    }

    /// <summary>How many people are near: the murmur follows.</summary>
    public void SetCrowd(double n) => crowdN = Math.Max(0, n);

    /// <summary>
    /// The people walking about, as (x, z): the murmur follows how many near you are talking, that is, stand within
    /// 3 m of someone else. Each counts in full within 5 m and not at all past 18 m. One person alone makes no murmur.
    /// The list is kept for the market and the events' voices (read in the same frame).
    /// </summary>
    public void SetCrowdAround(IReadOnlyList<Vector2> around)
    {
        people = around;
        crowdN = Talkers(listenerPos.X, listenerPos.Z, 5, 18);
    }

    /// <summary>People near (x, z) with someone to talk to: full within `near` m, none past `far` m.</summary>
    private double Talkers(double x, double z, double near, double far)
    {
        double box = far + TalkM;
        var close = new List<Vector2>();
        foreach (var p in people)
        {
            double dx = p.X - x, dz = p.Y - z;
            if (dx <= box && dx >= -box && dz <= box && dz >= -box) close.Add(p);
        }
        double n = 0;
        for (int i = 0; i < close.Count; i++)
        {
            var a = close[i];
            double d = Hyp(a.X - x, a.Y - z);
            if (d >= far) continue;
            bool partner = false;
            for (int j = 0; j < close.Count && !partner; j++)
                if (j != i && Math.Abs(close[j].X - a.X) < TalkM && Math.Abs(close[j].Y - a.Y) < TalkM && Hyp(close[j].X - a.X, close[j].Y - a.Y) < TalkM) partner = true;
            if (partner) n += 1 - Ramp(d, near, far);
        }
        return n;
    }

    /// <summary>People within `r` m of (x, z), each in full.</summary>
    private int PeopleNear(double x, double z, double r)
    {
        int n = 0;
        foreach (var p in people)
        {
            double dx = p.X - x, dz = p.Y - z;
            if (dx * dx + dz * dz < r * r) n++;
        }
        return n;
    }

    /// <summary>
    /// The great storm: `level` 0..1 how hard it blows, `gust` the gust at the ear now. The wind roars and howls with
    /// the gusts, the rain drums harder; 0 leaves every bed as it was.
    /// </summary>
    public void SetTempest(double level, double gust, double shelter = 0)
    {
        if (level > 0 && stormBeds == null) LoadStorm();
        tempest = Clamp01(level);
        tempestGust = Math.Max(0, Math.Min(3, gust));
        tempestShelter = Clamp01(shelter);
    }

    /// <summary>Rain 0-1: on roofs and cobbles; dampens gulls, market and dogs.</summary>
    public void SetRain(double a)
    {
        rain = Clamp01(a);
        if (rain > 0)
        {
            StartBed("rainRoofs", rainRoofSpot, 1);
            StartBed("rainCobbles", rainCobbleSpot, 1);
        }
    }

    /// <summary>
    /// The carts the world shows, every frame: a dray gets hooves and wheels, a handcart its wheels, while it rolls.
    /// The unseen carts in the fog keep away from them.
    /// </summary>
    public void SetVehicles(IReadOnlyList<VehicleSound> list)
    {
        double px = listenerPos.X, pz = listenerPos.Z;
        while (vehicles.Count > list.Count)
        {
            StopVoice(vehicles[^1].voice);
            vehicles.RemoveAt(vehicles.Count - 1);
        }
        // only the nearest few rolling ones get a voice (VehicleCap)
        var near = new List<double>();
        foreach (var v in list)
        {
            double d = Hyp(v.X - px, v.Z - pz);
            if (v.State == "go" && d < (v.Kind == "dray" ? CartLoop : HandcartLoop).Radius) near.Add(d);
        }
        near.Sort();
        double within = near.Count > VehicleCap ? near[VehicleCap - 1] : double.PositiveInfinity;
        for (int i = 0; i < list.Count; i++)
        {
            var v = list[i];
            if (i >= vehicles.Count) vehicles.Add((v, null));
            else if (vehicles[i].v.Kind != v.Kind)
            {
                StopVoice(vehicles[i].voice);
                vehicles[i] = (v, null);
            }
            var voice = vehicles[i].voice;
            var def = v.Kind == "dray" ? CartLoop : HandcartLoop;
            double d = Hyp(v.X - px, v.Z - pz);
            bool capped = d > within;
            bool on = d < def.Radius && !capped;
            if (on && voice == null) voice = StartVoice(v.X, 1, v.Z, def);
            if (voice != null)
            {
                if ((!on && !(d <= def.Radius + 10)) || capped)
                {
                    // (NaN: a vehicle at no place goes quiet)
                    StopVoice(voice);
                    voice = null;
                }
                else
                {
                    MoveSpot(voice.Spot, v.X, v.Z);
                    (voice.Spot.LevelT, voice.Spot.LevelTau) = (v.State == "go" ? 1 - 0.3 * rain : 0, 0.25);
                }
            }
            vehicles[i] = (v, voice);
        }
    }

    /// <summary>Replace the positioned sound sources (loops and event spots): the browser's `emitters`.</summary>
    public void SetEmitters(List<Emitter> list)
    {
        foreach (var l in live) StopVoice(l.Voice);
        live = list.Select(e => new Live { E = e }).ToList();
    }

    /// <summary>The world's own lamps join the city's (the browser's constructor argument): doubles within 1 m are dropped.</summary>
    public void AddLamps(IEnumerable<Vector3> lamps)
    {
        foreach (var p in lamps)
            if (!live.Any(l => l.E.Kind == "lamp" && Hyp(l.E.X - p.X, l.E.Z - p.Z) < 1))
                live.Add(new Live { E = new Emitter { Kind = "lamp", X = p.X, Z = p.Z, Y = p.Y, Name = "gas lamp" } });
    }

    /// <summary>Where the world's ships lie (the browser's constructor argument): the wind in the rigging is by them. Until it is set: the moored rows of the city file.</summary>
    public void SetShips(IEnumerable<Vector3> ships)
    {
        shipPositions.Clear();
        shipPositions.AddRange(ships);
    }

    // ------------------------------------------------------------------ time of day

    /// <summary>0 at night, 1 by day; clock unknown counts as day.</summary>
    private double Dayness
    {
        get
        {
            double h = HourNow;
            return h < 12 ? Ramp(h, 5.5, 8) : 1 - Ramp(h, 18, 21);
        }
    }

    private double HourNow => clock == null ? 10 : (clock.Value % 24 + 24) % 24;

    /// <summary>Gas lamps lit (the world's daylight table, roughly); unknown clock: lit.</summary>
    private double LampsLit
    {
        get
        {
            if (clock == null) return 1;
            double h = HourNow;
            if (h < 5.5 || h >= 18.5) return 1;
            if (h < 7) return 1 - 0.3 * Ramp(h, 5.5, 7);
            if (h < 9) return 0.7 * (1 - Ramp(h, 7, 9));
            if (h < 15) return 0;
            if (h < 17) return 0.4 * Ramp(h, 15, 17);
            return 0.4 + 0.6 * Ramp(h, 17, 18.5);
        }
    }

    /// <summary>How loud a kind of loop is at this hour and weather.</summary>
    private double KindLevel(string kind)
    {
        double night = 1 - Dayness;
        double h = HourNow;
        switch (kind)
        {
            case "bridge":
            case "pontoon": return 1 + 0.4 * night + 0.3 * rain;
            case "smithy": return smithyOn ? Ramp(h, 7, 7.5) * (1 - Ramp(h, 18.5, 19)) : 0;
            // the talk follows the people inside (SetPlacePeople), at any hour it is open; the song keeps its hours
            case "tavern": return 1;
            // the fish market is a morning market
            case "market": return Ramp(h, 6, 7) * (1 - Ramp(h, 13, 15)) * (1 - 0.5 * rain);
            case "lamp": return LampsLit;
            default: return 1;
        }
    }

    // ------------------------------------------------------------------ per frame

    /// <summary>Every frame: the ear is the camera; the water sits on the nearest quay edge; the chance sounds take their turns.</summary>
    public void Update(Camera3D cam)
    {
        // (a camera at no place, NaN for a frame: the ear stays where it last was)
        var at = cam.GlobalPosition;
        if (!at.IsFinite())
        {
            WarnOnce("the camera is at no place (NaN): the ear stays put");
            return;
        }
        listenerPos = at;

        // water sits on the nearest quay edge; over the water (pier, deck, pontoon) all round you
        double px = listenerPos.X, pz = listenerPos.Z;
        if (Emitters.OverWater(px, pz))
        {
            (waterSpot.X, waterSpot.Z) = (px, pz);
            quayDist = 0;
        }
        else
        {
            var q = Emitters.NearestQuay(px, pz);
            quayDist = q.d;
            if (double.IsFinite(q.d)) (waterSpot.X, waterSpot.Z) = (q.x, q.z);
        }
        // swimming, the water is right at your ears; the lapping is down at the water, wherever the tide has it
        waterSpot.Y = Math.Min(WaterLevel + 0.2, listenerPos.Y - 0.4);
        waterSpot.Moved = true;

        bool slow = now > nextSlow;
        if (slow)
        {
            SlowTick();
            nextSlow = now + 0.25;
        }
        MoveCarts(slow);
        if (!Auto) return;

        if (now > nextLap)
        {
            Lap();
            nextLap = now + Rand(0.25, 1.4);
        }
        if (!Chance) return;
        if (now > nextHorn)
        {
            // the foghorn only in fog, and never within the horn gap of a ship's whistle
            double chance = weather != null ? WeatherFar[weather].horn : 0;
            if (weather == "fog" && HornFree() && Rnd() < chance) Foghorn();
            nextHorn = now + Rand(40, 90);
        }
        if (now > nextGull)
        {
            // gulls by day; rain keeps them down
            if (Dayness > 0.3 && Rnd() > rain * 0.8) Gulls();
            nextGull = now + Rand(12, 35);
        }
        if (now > nextCreak)
        {
            Creak();
            nextCreak = now + Rand(5, 14);
        }
        double day = Dayness;
        if (now > nextDog)
        {
            if (Rnd() > rain * 0.6) Dog();
            nextDog = now + (day > 0.5 ? Rand(35, 90) : Rand(15, 45));
        }
        if (now > nextWhistle)
        {
            // a steamer far down the river, unseen; only while the world reports no ships of its own
            if (shipSounds.Count == 0 && HornFree()) SteamWhistle();
            nextWhistle = now + Rand(90, 240) * (day > 0.5 ? 1 : 2);
        }
        if (now > nextCrane)
        {
            var c = Nearest("crane", 90);
            if (c != null && Rnd() < day) CraneWork(c);
            nextCrane = now + Rand(14, 40);
        }
        if (now > nextCooper)
        {
            var c = Nearest("cooper", 70);
            if (c != null && Rnd() < day) CooperWork(c);
            nextCooper = now + Rand(5, 14);
        }
        if (now > nextPump)
        {
            var p = Nearest("pump", 50);
            if (p != null && Rnd() < 0.3 + 0.7 * day) Pump(p);
            nextPump = now + Rand(25, 70);
        }
        if (now > nextCarriage)
        {
            if (Rnd() < day) CarriageFar();
            nextCarriage = now + Rand(50, 120);
        }
    }

    /// <summary>The street's level and the walls' lowpass follow their targets (the browser's street gain and streetLp).</summary>
    private void TickStreet(double dt)
    {
        double g = Toward(streetGain, streetGainT, streetTau, dt);
        double lp = Toward(streetLp, streetLpT, streetTau, dt);
        if (Math.Abs(g - streetGain) > 1e-4)
        {
            streetGain = g;
            AudioServer.SetBusVolumeDb(busIndex["Street"], Db(g));
        }
        if (Math.Abs(lp - streetLp) > streetLp * 0.005)
        {
            streetLp = lp;
            streetLpFx.CutoffHz = (float)Math.Min(20000, lp);
        }
    }

    /// <summary>Four times a second: beds follow the state; loops start and stop by distance.</summary>
    private void SlowTick()
    {
        double night = 1 - Dayness;
        double on = Auto ? 1 : 0;
        // the water bed: its panner falls off from the quay edge; a row of houses between you and the edge muffles it;
        // full at the edge, gone 6 m from it (the great storm: the river pounding the quays is heard a street or two back)
        double wOcc = quayDist > 0 ? Occlusion(waterSpot.X, waterSpot.Z, 1).gain : 1;
        double wFar = 1 - Ramp(quayDist, 1, 6 + 30 * tempest);
        (waterSpot.LevelT, waterSpot.LevelTau) = (on * 0.5 * (1 + 0.4 * night) * (1 + 2.2 * tempest) * wOcc * wFar, 0.8);
        // the low wind rumble: about 10 dB down in the streets, a little more by open water
        double byWater = 1 - Ramp(quayDist, 15, 120);
        windSpot.LevelT = on * (0.3 + 0.15 * night) * (0.65 + 0.35 * byWater) * (1 + 1.6 * tempest);
        // the great storm: the howl, harder in each gust
        howlGainT = on * (stormBeds != null ? 0.08 : 0.16) * tempest * (0.45 + 0.35 * tempestGust);
        // wind in the rigging: by the ships (the canals have no masts), gone a street or two inland
        double dShip = double.PositiveInfinity;
        foreach (var sp in shipPositions) dShip = Math.Min(dShip, Hyp(sp.X - listenerPos.X, sp.Z - listenerPos.Z));
        double byShips = 1 - Ramp(dShip, 25, 100);
        windRecSpot.LevelT = on * (0.04 + 0.06 * night + 0.04 * rain) * byShips;
        for (int i = 0; i < spots.Count; i++) TuneSpot(spots[i], false);
        murmurSpot.LevelT = on * 0.22 * Chatter(crowdN) * (1 - 0.3 * rain);
        // the room's talk and song follow the people in it
        foreach (var b in roomBeds) (b.spot.LevelT, b.spot.LevelTau) = (b.baseGain * RoomLevel(b.name), 1.2);
        // an event's murmur follows the people standing near it
        foreach (var c in crowdSpots) (c.v.LevelT, c.v.LevelTau) = (Chatter(PeopleNear(c.spot.X, c.spot.Z, 15)), 1.2);
        // (the great storm: it drums on the roofs round him, loud in a lane or a doorway, far off on open ground; in
        // the open a broad roar of rain on everything)
        double T = tempest;
        double roofNear = 0.25 + 0.75 * tempestShelter;
        rainRoofSpot.LevelT = on * 0.4 * rain * (1 + T * ((1 + 1.4) * roofNear - 1));
        rainCobbleSpot.LevelT = on * 1.1 * rain * (1 + 0.7 * T);
        // the recorded gale and downpour when they are in (the made ones stay under them, quieter)
        var rec = stormBeds;
        if (downpourSpot != null) (downpourSpot.LevelT, downpourSpot.LevelTau) = (on * (rec != null ? 0.05 : 0.16) * rain * T * (1 - 0.45 * tempestShelter), 1.5);
        if (rec != null)
        {
            bool outside = roomKind == null;
            (rec.Value.rain.LevelT, rec.Value.rain.LevelTau) = (outside ? on * 1.3 * rain * T * (1 - 0.35 * tempestShelter) : 0, 1.2);
            (rec.Value.gale.LevelT, rec.Value.gale.LevelTau) = (outside ? on * 1.1 * T * (0.45 + 0.3 * Math.Min(tempestGust, 2)) : 0, 0.4);
            // in a room: the storm raging outside as it is heard from indoors (shutters, the house taking the gusts)
            (rec.Value.inside.LevelT, rec.Value.inside.LevelTau) = (roomKind != null ? on * 0.9 * T : 0, 0.8);
        }
        // indoors in it: the storm through thick walls, much duller and quieter than a shower heard from a room
        if (roomKind != null && streetIn.gain < 0.9) (streetGainT, streetLpT, streetTau) = (streetIn.gain * (1 - 0.55 * T), streetIn.lp * (1 - 0.45 * T), 0.5);

        if (now > smithyNext)
        {
            smithyOn = !smithyOn;
            smithyNext = now + (smithyOn ? Rand(20, 45) : Rand(6, 18));
        }
        if (!Auto)
        {
            foreach (var l in live)
            {
                if (l.Voice == null) continue;
                StopVoice(l.Voice);
                l.Voice = null;
                l.Level = 0;
            }
            return;
        }

        double px = listenerPos.X, pz = listenerPos.Z;
        // the loops within their radius, nearest first: only LoopCap of them sound at once
        cands.Clear();
        foreach (var l in live)
        {
            if (!Loops.TryGetValue(l.E.Kind, out var def)) continue;
            double d = Hyp(l.E.X - px, l.E.Z - pz);
            if (!(d < def.Radius + 12) && l.Voice == null)
            {
                l.Level = 0;
                continue;
            }
            double edge = 1 - Ramp(d, def.Radius * 0.7, def.Radius);
            double level = d < def.Radius ? KindLevel(l.E.Kind) * (l.E.Gain ?? 1) * edge : 0;
            // talk needs people: a tavern's by who is inside (unknown: nobody), the market's by who stands there
            if (level > 0 && l.E.Kind == "tavern") level *= Chatter(l.E.Id != null ? placePeople.GetValueOrDefault(l.E.Id) : 0);
            else if (level > 0 && l.E.Kind == "market") level *= Chatter(PeopleNear(l.E.X, l.E.Z, 25));
            if (level > 0.001 || l.Voice != null) cands.Add((l, def, d, level));
            else l.Level = 0;
        }
        cands.Sort((a, b) => a.d.CompareTo(b.d));
        int playing = 0;
        foreach (var (l, def, d, want) in cands)
        {
            bool room = want > 0.001 && playing < LoopCap;
            if (room) playing++;
            double level = room ? want : 0;
            if (room && l.Voice == null) l.Voice = StartVoice(l.E.X, l.E.Y ?? 1, l.E.Z, def);
            if (l.Voice != null)
            {
                if (level <= 0.001 && (d > def.Radius + 10 || want > 0.001))
                {
                    // out of reach, or pushed out by nearer loops
                    StopVoice(l.Voice);
                    l.Voice = null;
                }
                else (l.Voice.Spot.LevelT, l.Voice.Spot.LevelTau) = (level, 0.6);
                // a tavern sings only with a room full enough, in the evening
                if (l.Voice != null && l.E.Kind == "tavern")
                {
                    double song = Singing(l.E.Id != null ? placePeople.GetValueOrDefault(l.E.Id) : 0) * SongHours();
                    foreach (var ly in l.Voice.Layers) if (ly.name == "tavernSong") (ly.v.LevelT, ly.v.LevelTau) = (song, 0.8);
                }
            }
            l.Level = level;
        }
    }
    private readonly List<(Live l, LoopDef def, double d, double level)> cands = new();

    // ------------------------------------------------------------------ loops

    private LoopVoice? StartVoice(double x, double y, double z, LoopDef def)
    {
        if (!Finite(x, z) || !double.IsFinite(y)) return null;
        var layers = def.Layers.Where(l => l.name == "hiss" ? hissLoop != null : buf.ContainsKey(l.name)).ToArray();
        if (layers.Length == 0) return null;
        // (the loops go to the street itself, past the Sound settings' groups, as in the browser)
        var spot = NewSpot(x, y, z, def.Ref, def.Rolloff, def.Reach, def.Wet, def.Lowpass, "Street", def.Radius, def.Occl);
        spot.Hold = true;
        spot.Level = spot.LevelT = 0;
        var voice = new LoopVoice { Spot = spot };
        foreach (var (name, g) in layers)
        {
            V v;
            if (name == "hiss") v = Add(spot, hissLoop!.Value.stream, "hiss", g * hissLoop.Value.scale, from: Rnd() * 2.9, rawPeak: hissLoop.Value.scale * 0.95);
            else
            {
                var b = buf[name];
                v = Add(spot, b, name, g, Rand(0.97, 1.03), Rnd() * Math.Max(0, b.GetLength() - 0.1));
            }
            voice.Layers.Add((name, g, v));
        }
        return voice;
    }

    private void StopVoice(LoopVoice? v)
    {
        if (v == null) return;
        FadeDrop(v.Spot, 0.3, 1.6);
    }

    /// <summary>A bed loop on a place at the ear (or on the water's panner).</summary>
    private void StartBed(string name, Spot sp, double gain)
    {
        if (!buf.TryGetValue(name, out var b) || !bedsStarted.Add(name)) return;
        Add(sp, b, name, gain, from: Rnd() * b.GetLength());
    }

    // ------------------------------------------------------------------ carts in the fog

    private Cart MakeCart(double[][] route, int i)
    {
        var lens = new double[route.Length - 1];
        double total = 0;
        for (int k = 1; k < route.Length; k++)
        {
            lens[k - 1] = Hyp(route[k][0] - route[k - 1][0], route[k][1] - route[k - 1][1]);
            total += lens[k - 1];
        }
        return new Cart { Route = route, Lens = lens, Total = total, S = Rand(0, total), Dir = i % 2 == 1 ? -1 : 1, Speed = Rand(1.1, 1.5), X = route[0][0], Z = route[0][1] };
    }

    /// <summary>
    /// Horses and carts walk their streets, heard but never seen: nearer than you can see in this weather they fall
    /// silent (a cart you could see but not find would be wrong). Day only, a stray one at night.
    /// </summary>
    private void MoveCarts(bool slow)
    {
        double dt = Math.Min(0.1, Math.Max(0, now - lastMove));
        lastMove = now;
        double px = listenerPos.X, pz = listenerPos.Z;
        foreach (var c in carts)
        {
            c.S += c.Dir * c.Speed * dt;
            if (c.S > c.Total) (c.S, c.Dir) = (c.Total, -1);
            if (c.S < 0) (c.S, c.Dir) = (0, 1);
            double s = c.S;
            int k = 0;
            while (k < c.Lens.Length - 1 && s > c.Lens[k]) s -= c.Lens[k++];
            double t = c.Lens[k] != 0 ? s / c.Lens[k] : 0;
            c.X = c.Route[k][0] + (c.Route[k + 1][0] - c.Route[k][0]) * t;
            c.Z = c.Route[k][1] + (c.Route[k + 1][1] - c.Route[k][1]) * t;
            if (c.Voice != null) MoveSpot(c.Voice.Spot, c.X, c.Z);
            if (!slow) continue; // gains four times a second
            double d = Hyp(c.X - px, c.Z - pz);
            bool real = false;
            foreach (var v in vehicles) if (Hyp(v.v.X - c.X, v.v.Z - c.Z) < 40) real = true;
            // only beyond what you can see in this weather; on a clear day that is past the cart's own radius, so they are silent
            double seen = WeatherNow.seen;
            double level = Auto && d < CartLoop.Radius && !real ? (0.1 + 0.9 * Dayness) * Ramp(d, seen, seen + 12) * (1 - 0.3 * rain) : 0;
            if (level > 0.001 && c.Voice == null) c.Voice = StartVoice(c.X, 1, c.Z, CartLoop);
            if (c.Voice != null)
            {
                if (level <= 0.001 && (d > CartLoop.Radius + 10 || d < seen || !Auto))
                {
                    StopVoice(c.Voice);
                    c.Voice = null;
                }
                else (c.Voice.Spot.LevelT, c.Voice.Spot.LevelTau) = (level, 0.5);
            }
            c.Level = level;
        }
    }

    // ------------------------------------------------------------------ ships under way

    /// <summary>
    /// The ships moving on the river, every frame. Each steam ship within 120 m gets its engine (and paddle wheels) on
    /// its own panner, dulled by distance and fog. Steam ships whistle now and then: once as they come within 150 m,
    /// and to greet another steamer near them; tugs toot short, big steamers give a deep long blast. Sailing ships
    /// only ring their bell or call an order. All whistles share the horn gap with the foghorn.
    /// </summary>
    public void SetMovingShips(IReadOnlyList<MovingShip> list)
    {
        double px = listenerPos.X, pz = listenerPos.Z;
        var ids = new HashSet<string>(list.Select(s => s.Id));
        for (int i = shipSounds.Count - 1; i >= 0; i--)
        {
            if (ids.Contains(shipSounds[i].Ship.Id)) continue;
            StopVoice(shipSounds[i].Voice);
            shipSounds.RemoveAt(i);
        }
        foreach (var ship in list)
        {
            var s = shipSounds.Find(q => q.Ship.Id == ship.Id);
            if (s == null)
            {
                s = new ShipSound { Ship = ship, NextCall = now + Rand(5, 30) };
                shipSounds.Add(s);
            }
            s.Ship = ship;
            s.D = Hyp(ship.X - px, ship.Z - pz);
            if (s.Voice != null) MoveSpot(s.Voice.Spot, ship.X, ship.Z);
        }
        if (now < shipTickAt) return;
        shipTickAt = now + 0.25;

        foreach (var s in shipSounds)
        {
            var ship = s.Ship;
            if (ship.Anchored)
            {
                // a ship at anchor: no engine, a deep blast every few minutes, heard far across the river
                if (s.D < WhistleMax && now > s.NextCall && HornFree())
                {
                    Whistle(ship, "pass");
                    s.NextCall = now + Rand(150, 360);
                }
                continue;
            }
            if (ship.Steam)
            {
                var def = IsPaddle(ship.Kind) ? PaddleLoop : ScrewLoop;
                if (s.D < def.Radius && s.Voice == null) s.Voice = StartVoice(ship.X, 2, ship.Z, def);
                if (s.Voice != null && s.D > def.Radius + 10)
                {
                    StopVoice(s.Voice);
                    s.Voice = null;
                }
                s.Level = s.Voice != null ? (0.3 + 0.7 * Clamp01(ship.Speed / 3)) * (IsTug(ship.Kind) ? 0.8 : 1) : 0;
                if (s.Voice != null) (s.Voice.Spot.LevelT, s.Voice.Spot.LevelTau) = (s.Level, 0.5);
                // a whistle as it comes by (inside the horn gap it waits, and gives up once the ship is close)
                if (!s.Approached && s.D < 150)
                {
                    if (HornFree())
                    {
                        s.Approached = true;
                        if (Rnd() < 0.7) Whistle(ship, "pass");
                    }
                    else if (s.D < 60) s.Approached = true;
                }
                else if (s.Approached && s.D > 220) s.Approached = false;
            }
            else if (s.D < 70 && now > s.NextCall)
            {
                // a sailing ship: the bell, or an order called on deck
                if (Rnd() < 0.5) ShipBellAt(ship, 2);
                else ShoutAt(ship);
                s.NextCall = now + Rand(35, 80);
            }
        }

        // two steamers meeting greet each other: one whistles, the other answers
        var steam = shipSounds.Where(s => s.Ship.Steam && s.D < 300).ToList();
        for (int i = 0; i < steam.Count; i++)
            for (int j = i + 1; j < steam.Count; j++)
            {
                var a = steam[i];
                var b = steam[j];
                if (Hyp(a.Ship.X - b.Ship.X, a.Ship.Z - b.Ship.Z) > 90) continue;
                string key = string.CompareOrdinal(a.Ship.Id, b.Ship.Id) < 0 ? a.Ship.Id + "|" + b.Ship.Id : b.Ship.Id + "|" + a.Ship.Id;
                if (now < greeted.GetValueOrDefault(key) || !HornFree()) continue;
                greeted[key] = now + Rand(240, 420);
                if (Rnd() < 0.6)
                {
                    double dur = Whistle(a.Ship, "greet");
                    Whistle(b.Ship, "greet", dur + Rand(1.5, 3), true);
                }
            }
    }

    /// <summary>
    /// A ship asks the lock or a bridge to open: one long, one short blast (a sailing ship calls and rings its bell,
    /// long then short), answered by the bridge-keeper's hand bell from the nearest bridge. Signals always sound but
    /// still hold back the next horn by the horn gap. `at`: "lock" or "bridge".
    /// </summary>
    public void ShipSignal(MovingShip ship, string at)
    {
        double dur;
        if (ship.Steam) dur = Whistle(ship, "signal", 0, true);
        else
        {
            ShoutAt(ship);
            ShipBellAt(ship, 2, 1.2);
            dur = 3;
        }
        Log($"signal {at} {ship.Kind}");
        var keeper = NearestTo("bridge", ship.X, ship.Z, 250);
        if (keeper == null || !buf.TryGetValue("handbell", out var bell)) return;
        double len = Rand(2.2, 4.4);
        Slice(bell, "handbell", keeper.X, 3, keeper.Z, 0, len, 0.7, Rand(0.95, 1.05), 300, 4, dur + Rand(1.5, 3), 150);
        Log("bridge-keeper's bell");
    }

    /// <summary>
    /// A steam whistle from a ship. Tugs: short toots; big steamers: a deep long blast; "signal": one long, one
    /// short. Returns how long it lasts (s). `force`: play even inside the horn gap (an answer, a signal).
    /// </summary>
    private double Whistle(MovingShip ship, string why, double delay = 0, bool force = false)
    {
        if (!force && !HornFree()) return 0;
        if (!buf.TryGetValue("steamboatWhistle", out var lng)) return 0;
        buf.TryGetValue("tugToots", out var toots);
        bool tug = IsTug(ship.Kind);
        double rate = tug ? Rand(1.0, 1.08) : Rand(0.7, 0.78);
        const double reach = 450; // how far a whistle stays bright
        double x = ship.X, z = ship.Z;
        // ref 7-10 m, silent past WhistleMax, muffled half by the houses
        double dur;
        if (why == "signal")
        {
            double l = 2.2 / rate;
            Slice(lng, "whistle", x, 8, z, 0, 2.2, 0.8, rate, reach, 9, delay, WhistleMax, 0.5);
            Slice(lng, "whistle", x, 8, z, 0, 0.6, 0.8, rate, reach, 9, delay + l + 0.7, WhistleMax, 0.5);
            dur = l + 0.7 + 0.6 / rate;
        }
        else if (tug && toots != null)
        {
            int n = why == "greet" ? 1 : Rnd() < 0.5 ? 2 : 3;
            double t = delay;
            for (int i = 0; i < n; i++)
            {
                var span = Samples.TootSpans[i % Samples.TootSpans.Length];
                Slice(toots, "toot", x, 8, z, span[0], span[1], 0.75, rate, reach, 7, t, WhistleMax, 0.5);
                t += (span[1] - span[0]) / rate + 0.35;
            }
            dur = t - delay;
        }
        else
        {
            double len = why == "greet" ? Rand(1.6, 2.4) : Rand(3.2, 4.6);
            Slice(lng, "whistle", x, 8, z, 0, len, 0.85, rate, reach, 10, delay, WhistleMax, 0.5);
            dur = len / rate;
        }
        HornCount++;
        HornUsed();
        Log($"whistle {why} {ship.Kind}");
        return dur;
    }

    /// <summary>A ship's bell rung n times on a moving ship; `hold` lets the first ring sound longer.</summary>
    private void ShipBellAt(MovingShip ship, int n, double hold = 0)
    {
        if (!buf.TryGetValue("shipBell", out var b)) return;
        double t = 0;
        for (int i = 0; i < n; i++)
        {
            bool first = i == 0 && hold > 0;
            Slice(b, "ship's bell", ship.X, 4, ship.Z, 0, first ? b.GetLength() : 1.6, 0.5, 0.9, 300, 4, t, 150);
            t += first ? hold : 0.45;
        }
        Log($"ship's bell {ship.Kind}");
    }

    /// <summary>An order called on deck.</summary>
    private void ShoutAt(MovingShip ship)
    {
        if (!buf.TryGetValue("heaveShout", out var b)) return;
        Slice(b, "shout", ship.X, 3, ship.Z, 0, b.GetLength(), 0.6, Rand(0.88, 1.0), 200, 3, 0, 80);
        Log($"shout {ship.Kind}");
    }

    private bool HornFree() => now >= hornOkAt;
    private void HornUsed() => hornOkAt = now + Rand(HornGap[0], HornGap[1]);

    private Emitter? NearestTo(string kind, double x, double z, double within)
    {
        Emitter? best = null;
        double bd = within;
        foreach (var l in live)
        {
            if (l.E.Kind != kind) continue;
            double d = Hyp(l.E.X - x, l.E.Z - z);
            if (d < bd) (best, bd) = (l.E, d);
        }
        return best;
    }

    // ------------------------------------------------------------------ bells

    /// <summary>The hour: the carillon's voorslag, then the strokes of the big bell.</summary>
    public void HourBells(double hour)
    {
        int n = (((int)Math.Round(hour) % 12) + 12) % 12;
        if (n == 0) n = 12;
        double tune = Carillon(false);
        Strike(n, tune + 0.8);
    }

    /// <summary>Strike the big bell n times, starting `delay` s from now.</summary>
    public void Strike(int n, double delay = 0)
    {
        var cat = Cathedral();
        if (!buf.TryGetValue("hourStroke", out var b) || cat == null) return;
        Log($"hour {n}");
        var spot = BellSpot(cat);
        // a big bell, deeper than the village one recorded
        for (int i = 0; i < n; i++) Add(spot, b, "hour stroke", 1.1, 0.82, 0, b.GetLength() / 0.82 + 0.1, delay + 0.05 + i * 2.6);
    }

    /// <summary>The cathedral carillon: the whole tune, or a short phrase. Returns its length (s).</summary>
    public double Carillon(bool shortPhrase)
    {
        var cat = Cathedral();
        if (!buf.TryGetValue("carillon", out var b) || cat == null) return 0;
        Log(shortPhrase ? "carillon short" : "carillon");
        var spot = BellSpot(cat);
        double dur = shortPhrase ? Samples.CarillonShort : b.GetLength();
        var env = shortPhrase ? new Env((0, 0.9), (dur - 1.2, 0.9), (dur, 0)) : new Env((0, 0.9));
        Add(spot, b, shortPhrase ? "carillon short" : "carillon", 1, 1, 0, dur + 0.05, 0.05, env);
        return dur;
    }

    /// <summary>Ship's watch bells, rung in pairs, from a ship near you.</summary>
    public void WatchBells(int n)
    {
        var ship = Nearest("ship", 160);
        if (!buf.TryGetValue("shipBell", out var b) || ship == null) return;
        Log($"watch {n}");
        var spot = NewSpot(ship.X + Rand(-4, 4), 4, ship.Z + Rand(-4, 4), 4, 1, 300, 0.6, 14000, Bus("ambience"), 180);
        double t = Rand(1, 4);
        for (int i = 0; i < n; i++)
        {
            Add(spot, b, "watch bell", 0.55, 0.9, 0, b.GetLength() / 0.9 + 0.1, t);
            t += i % 2 == 0 ? 0.42 : 1.25;
        }
    }

    // ------------------------------------------------------------------ speech and the events' sounds

    private static readonly double[][] SpeechVowels = { new[] { 730.0, 1090 }, new[] { 270.0, 2290 }, new[] { 530.0, 1840 }, new[] { 570.0, 840 }, new[] { 300.0, 870 }, new[] { 660.0, 1720 }, new[] { 440.0, 1020 } };

    /// <summary>
    /// A voice without words (the bubbles): noise and a glottal sawtooth through two vowel formants, 4-6 syllables a
    /// second, a pause now and then. Men 110 Hz, women 210, children 280, the old a tenth lower. Through the fog and
    /// the air like every placed sound (ref 2, rolloff 1.2, reach 40).
    /// </summary>
    public void Speech(double x, double z, VoiceOf voice, double seconds)
    {
        double dur = Math.Max(0.5, Math.Min(6, seconds));
        if (!(DistTo(x, 1.6, z) <= 35)) return;
        var spot = NewSpot(x, 1.6, z, 2, 1.2, 40, 0.25, 14000, Bus("voices"), 35);
        MadeAt(spot, (c, dest, t0) => SpeechMake(c, dest, t0, voice, dur), "speech", 0.16);
    }

    private static double SpeechMake(Wa c, Wa.Node dest, double t0, VoiceOf voice, double dur)
    {
        bool child = voice.Age < 13;
        double f0 = (child ? 280 : voice.Sex == "f" ? 210 : 110) * (voice.Age >= 60 ? 0.9 : 1) * Rand(0.93, 1.07);
        double scale = child ? 1.3 : voice.Sex == "f" ? 1.15 : 1;
        var osc = c.Osc("sawtooth");
        osc.Frequency.SetValueAtTime(f0, t0);
        var breath = c.Noise();
        var bGain = c.Gain(0.3);
        var mix = c.Gain(0.8);
        osc.Connect(mix);
        breath.Connect(bGain).Connect(mix);
        var f1 = c.Biquad("bandpass", 350, 6);
        var f2 = c.Biquad("bandpass", 350, 9);
        var env = c.Gain(0);
        mix.Connect(f1).Connect(env);
        mix.Connect(f2).Connect(env);
        env.Connect(dest);
        double t = t0;
        int n = 0;
        int nextPause = 3 + (int)Math.Floor(Rand(0, 4));
        while (t < t0 + dur)
        {
            double len = 1 / Rand(4, 6);
            var v = Pick(SpeechVowels);
            f1.Frequency.SetTargetAtTime(v[0] * scale, t, 0.02);
            f2.Frequency.SetTargetAtTime(v[1] * scale, t, 0.02);
            osc.Frequency.SetTargetAtTime(f0 * Rand(0.88, 1.18), t, 0.05);
            env.G.SetValueAtTime(0, t);
            env.G.LinearRampToValueAtTime(1, t + 0.03);
            env.G.LinearRampToValueAtTime(0.6, t + len * 0.6);
            env.G.LinearRampToValueAtTime(0, t + len * 0.92);
            t += len;
            if (++n >= nextPause)
            {
                t += Rand(0.12, 0.3);
                n = 0;
                nextPause = 3 + (int)Math.Floor(Rand(0, 4));
            }
        }
        osc.Start(t0);
        breath.Start(t0);
        osc.Stop(t + 0.1);
        breath.Stop(t + 0.1);
        return t + 0.1 - t0;
    }

    /// <summary>
    /// The sound of a street trade at a point for some seconds (audio/cries.ts): "grind" the knife grinder's stone,
    /// "rattle" the mussel seller's rattle, "clink" the milk cans, "scrub" a brush scrubbing the step.
    /// </summary>
    public void StreetWork(string kind, double x, double z, double seconds)
    {
        double max = kind == "rattle" ? 50 : 40;
        if (!(DistTo(x, 1, z) <= max)) return;
        var spot = NewSpot(x, 1.0, z, 2, 1.3, kind == "rattle" ? 45 : 30, 0.25, 14000, Bus("voices"), max);
        MadeAt(spot, (c, dest, t0) => Cries.WorkSound(c, dest, kind, seconds, t0) - t0, "street work " + kind, kind == "scrub" ? 0.12 : 0.22);
    }

    /// <summary>
    /// A line of a ballad or a street cry, sung (audio/ballad.ts): the tune's notes, a beat each, from a voice made in
    /// code at a point, louder than talk and carrying further (reach 55 m). Indoors run it through Indoors().
    /// Returns the seconds it lasts.
    /// </summary>
    public double Sing(double x, double z, VoiceOf voice, IReadOnlyList<Note> notes, double beat)
    {
        var spot = NewSpot(x, 1.6, z, 3, 1.1, 55, 0.3, 14000, Bus("music"), 60);
        bool child = voice.Age < 13;
        double f0 = (child ? 262 : voice.Sex == "f" ? 220 : 131) * (voice.Age >= 60 ? 0.94 : 1);
        double end = 0;
        MadeAt(spot, (c, dest, t0) =>
        {
            end = Ballad.SingPhrase(c, dest, f0, child ? 1.3 : voice.Sex == "f" ? 1.15 : 1, notes, beat, t0) - t0;
            return end + 0.1;
        }, "sung line", 0.2);
        Log("ballad line");
        return end;
    }

    /// <summary>
    /// An event's sound at a place for some seconds: "bells" (a festive peal from the tower), "alarm" (the fire alarm:
    /// the big bell struck fast at one pitch), "music" (the tavern song, a loop), "murmur" (walla), or "handbell"
    /// rung ahead of a procession. Returns a handle to move it (a procession) or stop it early.
    /// </summary>
    public SoundHandle EventSound(string kind, double x, double z, double seconds)
    {
        double secs = Math.Max(4, Math.Min(180, seconds));
        bool alarm = kind == "alarm";
        if (kind == "bells" || alarm)
        {
            // the big bell struck quickly at six pitches in rounds (the recorded stroke, played at different rates)
            var cat = Cathedral();
            if (!buf.TryGetValue("hourStroke", out var b) || cat == null) return new SoundHandle();
            Log("event peal");
            var spot = BellSpot(cat);
            double[] rates = alarm ? new[] { 1.18, 1.18, 1.18, 1.18, 1.18, 1.18 } : new[] { 1.5, 1.34, 1.2, 1.12, 1.0, 0.9 };
            int n = (int)Math.Floor(Math.Min(secs, 40) / 0.34);
            int[] swap = { 1, 0, 3, 2, 5, 4 };
            for (int i = 0; i < n; i++)
            {
                int round = i / rates.Length;
                // every other round the order changes a little, as ringers do
                int k = round % 2 == 1 ? swap[i % 6] : i % 6;
                // a breath between rounds (not in an alarm)
                Add(spot, b, alarm ? "alarm stroke" : "peal stroke", 0.55, rates[k], 0, 2.2 / rates[k], 0.05 + i * 0.34 + (alarm ? 0 : round * 0.4));
            }
            bool stopped = false;
            return new SoundHandle(null, () =>
            {
                if (stopped) return;
                stopped = true;
                FadeDrop(spot, 0.3, 1.05);
            });
        }
        if (kind == "handbell")
        {
            buf.TryGetValue("handbell", out var bell);
            var spot = NewSpot(x, 1.8, z, 3, 1.2, 120, 0.5, 14000, Bus("ambience"), 90);
            spot.Hold = true;
            bool on = true;
            int n = 0;
            void Ring()
            {
                if (!on || bell == null || n++ * 2.6 > secs)
                {
                    DropSpot(spot);
                    return;
                }
                double rate = Rand(0.95, 1.05);
                var v = Add(spot, bell, "procession handbell", 0.55, rate, 0, Math.Min(2.4, bell.GetLength()) / rate);
                v.OnEnd = Ring;
            }
            Ring();
            return new SoundHandle((mx, mz) => MoveSpot(spot, mx, mz), () => on = false);
        }
        bool murmur = kind == "murmur";
        if (!buf.TryGetValue(kind == "music" ? "tavernSong" : "murmur", out var loop)) return new SoundHandle();
        // a murmur is talk: heard near the gathering, and only as loud as the people there make it
        var sp = murmur ? NewSpot(x, 1.5, z, 3, 1.4, 30, 0.3, 14000, Bus("voices"), 35) : NewSpot(x, 1.5, z, 3, 1.2, 70, 0.3, 14000, Bus("music"), 90);
        double level = kind == "music" ? 0.5 : 0.7;
        var lv = Add(sp, loop, "event " + kind, 1, 1, 0, secs + 0.05, 0, new Env((0, 0), (2, level), (secs - 2, level), (secs, 0)));
        if (murmur)
        {
            lv.Level = lv.LevelT = Chatter(PeopleNear(x, z, 15));
            var entry = (sp, lv);
            crowdSpots.Add(entry);
            lv.OnEnd = () => crowdSpots.Remove(entry);
        }
        Log($"event {kind}");
        bool done = false;
        return new SoundHandle((mx, mz) => MoveSpot(sp, mx, mz), () =>
        {
            if (done) return;
            done = true;
            crowdSpots.RemoveAll(c => c.spot == sp);
            FadeDrop(sp, 0.3, 1.05);
        });
    }

    /// <summary>
    /// The sound of an event's stage as the director composed it: each cue fires at the place, then again every
    /// `EverySeconds` (a little uneven, as life is) until the stage ends or Stop(). The cues are made in
    /// EventCues: voices, a fiddle, a drum, glass, wood, fire in code; the bells, hooves and the dog from the
    /// recordings already in the game. Returns a handle to move or stop it.
    /// </summary>
    public SoundHandle EventCues(IReadOnlyList<CueSpec> cues, double x, double z, double seconds)
    {
        double secs = Math.Max(4, Math.Min(180, seconds));
        if (!Finite(x, z))
        {
            WarnOnce("event cues at no place (NaN): not played");
            return new SoundHandle();
        }
        var spot = NewSpot(x, 1.5, z, 3, 1.15, 75, 0.3, 14000, Bus("voices"), 100);
        spot.Hold = true;
        bool on = true;
        var mine = new List<Timer>();
        double endAt = now + secs;
        foreach (var cue in cues.Take(4))
        {
            void Fire()
            {
                if (!on) return;
                // Jef far off: this hit is skipped (nobody hears it), the next one still comes
                double d = DistTo(spot.X, spot.Y, spot.Z);
                // a crowd's voices need a crowd there and are heard near it; a shout or a cry needs someone
                bool group = GroupCues.Contains(cue.Source);
                bool one = VoiceCues.Contains(cue.Source);
                int near = group || one ? PeopleNear(spot.X, spot.Z, 15) : 0;
                double level = group ? Chatter(near) : one ? (near >= 1 ? 1 : 0) : 1;
                bool far = d > (group ? 35 : one ? 60 : spot.Max) || level <= 0;
                double len = 0;
                if (!far)
                {
                    len = MadeAt(spot, (c, dest, t0) => Audio.EventCues.PlayCue(c, dest, cue, t0), "cue " + cue.Source, 0.9 * level, 0.5);
                    Log($"cue {cue.Source}");
                }
                if (cue.EverySeconds <= 0) return;
                double wait = Math.Max(cue.EverySeconds * Rand(0.75, 1.3), len + 0.6);
                if (now + wait < endAt) mine.Add(After(wait, Fire));
            }
            mine.Add(After(Rand(0.2, 2.5), Fire));
        }
        void Stop()
        {
            if (!on) return;
            on = false;
            foreach (var t in mine) t.Dead = true;
            // the last hits ring out before the spot goes
            After(12, () => DropSpot(spot));
        }
        mine.Add(After(secs, Stop));
        return new SoundHandle((mx, mz) => MoveSpot(spot, mx, mz), Stop);
    }

    // ------------------------------------------------------------------ the town's life (world/alive): hook

    /// <summary>
    /// A sound made in code (AliveSounds) at a place, with its own real reach: inverse fall-off from `Ref` metres,
    /// dull towards `Reach`, silent past `Max` (not started beyond it). `make` builds the sound and returns its
    /// length in seconds. `Occl` 1 at street level, 0 in the air (a bird over the roofs, a bell buoy on open water).
    /// </summary>
    public bool Placed(Vector3 at, PlacedOpts o, Make make, string what = "placed")
    {
        double d = DistTo(at.X, at.Y, at.Z);
        // (`Must`: thunder, a gust's roar: never dropped for the cap, far as they are)
        if (!(d <= o.Max) || (!o.Must && placedCount >= SpotCap && d > 25)) return false; // (NaN: at no place, not played)
        var spot = NewSpot(at.X, at.Y, at.Z, o.Ref, o.Rolloff, o.Reach, o.Wet, 14000, Bus("voices"), o.Max, o.Occl);
        MadeAt(spot, make, what, o.Gain, 1.5);
        return true;
    }

    /// <summary>The listener (the camera), for choosing where a sound comes from.</summary>
    public Vector3 Ear => listenerPos;

    // ------------------------------------------------------------------ street events

    /// <summary>A dog far off, inland: a point on land 50-100 m off, or no bark.</summary>
    public void Dog()
    {
        if (!buf.TryGetValue("dogFar", out var b)) return;
        var at = FarOnLand(50, 100);
        if (at == null) return;
        var span = Pick(Samples.DogSpans);
        Slice(b, "dog", at.Value.x, 2, at.Value.z, span[0], span[1], 1, Rand(0.95, 1.05), 300, 3, 0, 110);
    }

    /// <summary>A point on land (inside the map, not over the water) some metres from the listener, or null.</summary>
    private (double x, double z)? FarOnLand(double near, double far)
    {
        for (int i = 0; i < 10; i++)
        {
            double a = Rand(0, Math.PI * 2);
            double d = Rand(near, far);
            double x = listenerPos.X + Math.Cos(a) * d;
            double z = listenerPos.Z + Math.Sin(a) * d;
            if (z > 2 && z < Emitters.TownZ0 + Emitters.TownH && x > Emitters.TownX0 && x < Emitters.TownX0 + Emitters.TownW && !Emitters.OverWater(x, z)) return (x, z);
        }
        return null;
    }

    /// <summary>A steam whistle from a boat on the river.</summary>
    public void SteamWhistle()
    {
        string name = Rnd() < 0.5 ? "steamWhistleFar" : "steamboatWhistle";
        if (!buf.TryGetValue(name, out var b)) return;
        // (inland past WhistleMax: nothing)
        Slice(b, name, listenerPos.X + Rand(-250, 250), 8, Rand(-250, -120), 0, b.GetLength(), name == "steamboatWhistle" ? 0.7 : 0.9, Rand(0.9, 1.0), 450, 10, 0, WhistleMax, 0.5);
        HornCount++;
        HornUsed();
        Log("whistle far");
    }

    /// <summary>The railway gate at the Werf store opens: the keeper rings his hand bell.</summary>
    public void GateBell(double x, double z)
    {
        if (!buf.TryGetValue("handbell", out var bell) || !(Hyp(x - listenerPos.X, z - listenerPos.Z) <= 110)) return;
        Slice(bell, "gate bell", x, 3, z, 0, Rand(1.8, 2.8), 0.6, Rand(0.95, 1.05), 150, 3, 0, 110);
        Log("railway gate bell");
    }

    /// <summary>An iron wheel over a rail joint: a knock and a short ring, made in code.</summary>
    public void RailClack(double x, double z)
    {
        if (!(Hyp(x - listenerPos.X, z - listenerPos.Z) <= 70)) return; // (NaN: at no place)
        var spot = NewSpot(x, 0.4, z, 4, 1.2, 70, 0.25, 14000, Bus("ambience"), 70);
        MadeAt(spot, (c, dest, t) =>
        {
            Burst(c, dest, t, 0.07, "bandpass", Rand(1700, 2300), 3, 0.45, 0.001);
            Burst(c, dest, t + 0.1, 0.06, "bandpass", Rand(1500, 2100), 3, 0.3, 0.001);
            Thump(c, dest, t, 65, 0.14, 0.4);
            return 0.6;
        }, "rail clack");
    }

    /// <summary>A crane at work: ratchet or winch, then the chain.</summary>
    public void CraneWork(Emitter c)
    {
        string name = Rnd() < 0.5 ? "ratchet" : "winch";
        if (!buf.TryGetValue(name, out var r)) return;
        double dur = Rand(2.5, 4.5);
        double start = Rand(0, Math.Max(0, r.GetLength() - dur));
        Slice(r, name, c.X, c.Y ?? 1, c.Z, start, start + dur, 0.7, Rand(0.85, 1.0), 150, 4, 0, 130);
        if (buf.TryGetValue("chain", out var ch) && Rnd() < 0.7) Slice(ch, "chain", c.X, c.Y ?? 1, c.Z, 0, ch.GetLength(), 0.6, Rand(0.8, 0.95), 150, 4, dur - 0.2, 130);
    }

    /// <summary>A cooper driving hoops on a cask: a run of mallet blows (Kenney wood impacts).</summary>
    public void CooperWork(Emitter c)
    {
        if (!fx.TryGetValue("thud_wood", out var wood) || !fx.TryGetValue("thud_plank", out var plank) || wood.Count == 0 || plank.Count == 0) return;
        int n = (int)Math.Floor(Rand(5, 10));
        double gap = Rand(0.42, 0.52);
        double rate = Rand(0.68, 0.78);
        for (int i = 0; i < n; i++)
        {
            bool hoop = i % 3 == 2;
            var b = Pick(hoop ? plank : wood);
            Slice(b, hoop ? "cooper hoop" : "cooper mallet", c.X, c.Y ?? 1, c.Z, 0, b.GetLength(), hoop ? 0.35 : 0.55, hoop ? rate * 1.9 : rate, 150, 3, i * gap + Rand(-0.02, 0.02), 80);
        }
    }

    /// <summary>A pump handle worked a few strokes.</summary>
    public void Pump(Emitter p)
    {
        if (!buf.TryGetValue("pump", out var b)) return;
        double dur = Rand(3, 7);
        double start = Rand(0, Math.Max(0, b.GetLength() - dur));
        Slice(b, "pump", p.X, p.Y ?? 1, p.Z, start, start + dur, 0.6, Rand(0.95, 1.05), 150, 3, 0, 60);
    }

    /// <summary>A carriage passing somewhere off in the fog: beyond what you can see in this weather, and soft.</summary>
    public void CarriageFar()
    {
        string name = Rnd() < 0.5 ? "carriageFar" : "carriageArch";
        if (!buf.TryGetValue(name, out var b)) return;
        double seen = WeatherNow.seen;
        var at = FarOnLand(Math.Max(55, seen + 10), Math.Max(95, seen + 30));
        if (at == null) return;
        Slice(b, name, at.Value.x, 1, at.Value.z, 0, b.GetLength(), 0.8, 1, 250, 4, 0, 140);
    }

    /// <summary>
    /// Play part of a recording at a place, with short fades: inverse fall-off from `refM` metres, duller towards
    /// `reach` metres, silent past `max` metres (not started at all there). With SpotCap sounds playing, only a near
    /// one (within 25 m) still starts.
    /// </summary>
    private void Slice(AudioStream b, string what, double x, double y, double z, double from, double to, double vol, double rate, double reach, double refM, double delay = 0, double max = 150, double occl = 1)
    {
        double d = DistTo(x, y, z);
        if (!(d <= max) || (placedCount >= SpotCap && d > 25)) return; // (NaN: at no place, not played)
        to = Math.Min(to, b.GetLength());
        var spot = NewSpot(x, y, z, refM, 1, reach, 0.35, 14000, Bus("ambience"), max, occl);
        double dur = Math.Max(0.05, (to - from) / rate);
        double f = Math.Min(0.08, dur / 4);
        Add(spot, b, what, 1, rate, from, dur, Math.Max(0, delay), new Env((0, 0), (from > 0 ? f : 0.005, vol), (dur - f, vol), (dur, 0)));
    }

    /// <summary>Dev: a warning once per text.</summary>
    private void WarnOnce(string what)
    {
        if (warned.Add(what)) GD.PushWarning($"[sound] {what}");
    }

    private void Log(string what)
    {
        Rung.Add(what);
        if (Rung.Count > 40) Rung.RemoveAt(0);
    }

    private Emitter? Nearest(string kind, double within) => NearestTo(kind, listenerPos.X, listenerPos.Z, within);

    private Emitter? Cathedral() => live.Find(l => l.E.Kind == "cathedral")?.E;

    /// <summary>The cathedral tower's bells: their own fall-off and dullness.</summary>
    private Spot BellSpot(Emitter cat)
    {
        var sp = NewSpot(cat.X, cat.Y ?? 1, cat.Z, Bell.refM, Bell.rolloff, Bell.reach, Bell.wet, 14000, Bus("ambience"), double.PositiveInfinity, Bell.occl);
        sp.Dull = Bell.dull;
        TuneSpot(sp, true);
        return sp;
    }

    // ------------------------------------------------------------------ distance

    /// <summary>Distance from the listener, in 3D (the bells hang 65 m up).</summary>
    private double DistTo(double x, double y, double z)
    {
        double dx = x - listenerPos.X, dy = y - listenerPos.Y, dz = z - listenerPos.Z;
        return Math.Sqrt(dx * dx + dy * dy + dz * dz);
    }

    /// <summary>
    /// What the house blocks between the listener and (x, z) do to a sound: its gain and a factor on its lowpass.
    /// `occl` 1 (street level): 12 m of houses halve it (-6 dB), at most -10 dB; 0: nothing. Inside a room the
    /// street is already muffled (SetInterior); no second muffling there.
    /// </summary>
    private (double gain, double lp) Occlusion(double x, double z, double occl)
    {
        if (occl <= 0 || roomKind != null) return (1, 1);
        double m = Emitters.BlockedMetres(listenerPos.X, listenerPos.Z, x, z);
        if (m <= 0) return (1, 1);
        double g = Math.Max(0.32, 1 / (1 + m / 12));
        return (1 - occl * (1 - g), 1 - 0.6 * occl * Ramp(m, 0, 30));
    }

    private (double lp, double gain, double horn, double seen) WeatherNow => weather != null ? WeatherFar[weather] : WeatherUnknown;

    /// <summary>Air lowpass: 14 kHz within 10 m, down to the weather's cutoff at `reach` m, duller beyond.</summary>
    private double AirLp(double d, double reach, double dull = 0.5)
    {
        double far = WeatherNow.lp;
        double f = 14000 * Math.Pow(far / 14000, Ramp(d, 10, reach));
        if (d > reach) f *= Math.Pow(reach / d, dull);
        return Math.Max(300, f);
    }

    /// <summary>Fog (mist, rain) takes a little more off far sounds: none within 30 m, the full weather loss by 300 m.</summary>
    private double FogLoss(double d) => 1 - (1 - WeatherNow.gain) * Ramp(d, 30, 300);

    // ------------------------------------------------------------------ dev

    /// <summary>What the sound holds now (dev checks: log it).</summary>
    public Dictionary<string, object?> Graph()
    {
        var byKind = new Dictionary<string, int>();
        foreach (var l in live) byKind[l.E.Kind] = byKind.GetValueOrDefault(l.E.Kind) + 1;
        return new Dictionary<string, object?>
        {
            ["state"] = State,
            ["samples"] = new Dictionary<string, object> { ["loaded"] = buf.Keys.ToArray(), ["failed"] = failed.ToArray() },
            ["emitters"] = byKind,
            ["active"] = live.Where(l => l.Voice != null).Select(l => new Dictionary<string, object> { ["kind"] = l.E.Kind, ["name"] = l.E.Name, ["level"] = Math.Round(l.Level, 3), ["layers"] = l.Voice!.Layers.Count }).ToArray(),
            ["carts"] = carts.Select(c => new Dictionary<string, object> { ["x"] = Math.Round(c.X, 1), ["z"] = Math.Round(c.Z, 1), ["level"] = Math.Round(c.Level, 3), ["playing"] = c.Voice != null }).ToArray(),
            ["vehicles"] = vehicles.Select(s => new Dictionary<string, object> { ["kind"] = s.v.Kind, ["x"] = Math.Round(s.v.X, 1), ["z"] = Math.Round(s.v.Z, 1), ["state"] = s.v.State, ["playing"] = s.voice != null }).ToArray(),
            ["beds"] = bedsStarted.ToArray(),
            ["gains"] = new Dictionary<string, object>
            {
                ["water"] = Math.Round(waterSpot.Level, 3),
                ["wind"] = Math.Round(windSpot.Level, 3),
                ["windRigging"] = Math.Round(windRecSpot.Level, 3),
                ["murmur"] = Math.Round(murmurSpot.Level, 3),
                ["rainRoofs"] = Math.Round(rainRoofSpot.Level, 3),
                ["rainCobbles"] = Math.Round(rainCobbleSpot.Level, 3),
                ["weatherLowpass"] = WeatherNow.lp,
                ["spots"] = placedCount,
            },
            ["mixer"] = new Dictionary<string, object> { ["places"] = spots.Count, ["busesFree"] = freeChans.Count, ["players3d"] = made3d, ["players2d"] = made2d, ["rendering"] = rendering, ["timers"] = timers.Count },
            ["cost"] = new Dictionary<string, object> { ["meanMs"] = costN > 0 ? Math.Round(costSum / costN, 4) : 0, ["maxMs"] = Math.Round(costMax, 3), ["maxAt_s"] = Math.Round(costMaxAt, 1), ["frames"] = costN },
            ["clock"] = clock,
            ["dayness"] = Math.Round(Dayness, 2),
            ["weather"] = weather ?? "unknown",
            ["hornOkIn"] = Math.Round(Math.Max(0, hornOkAt - now), 1),
            ["ships"] = shipSounds.Select(s => new Dictionary<string, object> { ["id"] = s.Ship.Id, ["kind"] = s.Ship.Kind, ["steam"] = s.Ship.Steam, ["d"] = Math.Round(s.D), ["loop"] = s.Voice != null, ["level"] = Math.Round(s.Level, 3) }).ToArray(),
            ["crowd"] = crowdN,
            ["roomPeople"] = roomPeople,
            ["roomBeds"] = roomBeds.Select(b => new Dictionary<string, object> { ["name"] = b.name, ["gain"] = Math.Round(b.spot.Level, 3) }).ToArray(),
            ["placePeople"] = placePeople,
            ["rain"] = rain,
            ["rung"] = Rung.ToArray(),
        };
    }

    public int SamplesLoaded => buf.Count;

    // ------------------------------------------------------------------ events (older)

    /// <summary>
    /// A boot in a puddle: one step cut from two recordings (Samples.PuddleSpans). The rumble under the recordings is
    /// cut, and the top kept soft. The filtered noise only plays when the recordings are missing.
    /// </summary>
    public void SplashStep(bool hurry, double wet)
    {
        var have = new List<int>();
        for (int i = 0; i < Samples.PuddleSpans.Length; i++) if (buf.ContainsKey(Samples.PuddleSpans[i].name)) have.Add(i);
        if (have.Count > 0)
        {
            int k = (int)Math.Floor(Rnd() * have.Count) % have.Count;
            if (have[k] == lastSplash && have.Count > 1) k = (k + 1) % have.Count;
            var (name, start, dur, level) = Samples.PuddleSpans[have[k]];
            lastSplash = have[k];
            bool soft = name == "puddleSteps";
            // highpass 110 Hz, lowpass 3.6 kHz (the splashier one) or 5 kHz
            ref Spot? sp = ref (soft ? ref splashSoft : ref splashHard);
            sp ??= FlatSpot(Bus("effects"), soft ? 3600 : 5000, 0, true, true);
            sp.Out = Bus("effects");
            SendChan(sp);
            double peak = 0.7 * level * Math.Min(1, 0.4 + wet * 0.6) * (hurry ? 1.25 : 1) * Rand(0.85, 1);
            Add(sp, buf[name], "puddle step", 1, Rand(0.9, 1.04) * (hurry ? 1.06 : 1), start, dur, 0, new Env((0, 0), (0.006, peak), (dur * 0.6, peak), (dur, 0)));
            return;
        }
        var flat = FlatSpot(Bus("effects"), 3800);
        MadeAt(flat, (c, dest, t) =>
        {
            const double len = 0.28;
            int n = (int)Math.Floor(c.Rate * len);
            var d = new float[n];
            for (int i = 0; i < n; i++)
            {
                double k = (double)i / n;
                // a sharp slap, then a hiss of drops falling back, patchy
                double env = Math.Exp(-k * 14) * 0.9 + Math.Exp(-k * 5) * 0.25 * (Rnd() < 0.35 ? 1 : 0.3);
                d[i] = (float)((Rnd() * 2 - 1) * env);
            }
            var src = c.Src(d, c.Rate);
            src.PlaybackRate = Rand(0.85, 1.15) * (hurry ? 1.1 : 1);
            src.Connect(c.Biquad("bandpass", Rand(900, 1600), 0.7)).Connect(c.Destination);
            src.Start(t);
            return len / src.PlaybackRate + 0.05;
        }, "puddle step (made)", 0.32 * Math.Min(1, wet) * (hurry ? 1.3 : 1));
    }

    /// <summary>The walking part calls this for each of Jef's steps: "stone" or "wood".</summary>
    public void Step(string surface) => Footstep(surface, false);

    /// <summary>A footstep on "stone" or "wood"; `puddle` 0..1 how wet the ground is there; `level` below 1 for another player's step further off.</summary>
    public void Footstep(string surface, bool hurry, double puddle = 0, double level = 1)
    {
        if (surface != "wood") surface = "stone";
        if (puddle > 0.3) SplashStep(hurry, puddle);
        double vol = (hurry ? 1.25 : 1) * Clamp01(level);
        var set = steps[surface];
        ref Spot? sp = ref (surface == "wood" ? ref stepWood : ref stepStone);
        if (set.Count > 0)
        {
            // recorded step (Kenney Impact Sounds, CC0): a bit slower and darker, heavy boots on wet ground rather
            // than shoes on a clean floor
            sp ??= FlatSpot(Bus("effects"), surface == "wood" ? 2600 : 2200, surface == "wood" ? 0.25 : 0.12, false, true);
            sp.Out = Bus("effects");
            SendChan(sp);
            int i = (int)Math.Floor(Rnd() * set.Count) % set.Count;
            if (i == lastStep && set.Count > 1) i = (i + 1) % set.Count;
            lastStep = i;
            // in a puddle the water takes the hard click off the stone
            double soft = puddle > 0.3 ? 1 - 0.55 * Math.Min(1, puddle) : 1;
            Add(sp, set[i], "footstep " + surface, 0.9 * (surface == "wood" ? 0.8 : 0.65) * vol * Rand(0.8, 1.0) * soft, Rand(0.78, 0.9) * (hurry ? 1.05 : 1));
            return;
        }
        // fallback when the recordings are missing: a made step
        var flat = FlatSpot(Bus("effects"), 0, surface == "wood" ? 0.25 : 0.12);
        MadeAt(flat, (c, dest, t) =>
        {
            if (surface == "stone")
            {
                // hobnail on wet cobble: short gritty click and a soft heel
                Burst(c, dest, t, 0.05, "bandpass", Rand(1800, 2600), 1.2, 0.5 * vol);
                Burst(c, dest, t + 0.012, 0.09, "lowpass", 500, 0.7, 0.35 * vol);
                Burst(c, dest, t + 0.03, 0.12, "highpass", 5000, 0.5, 0.05 * vol); // wet slap
            }
            else
            {
                // hollow planks over water
                Thump(c, dest, t, Rand(95, 120), 0.16, 0.7 * vol);
                Burst(c, dest, t, 0.14, "bandpass", Rand(380, 520), 4, 0.45 * vol);
                Burst(c, dest, t + 0.01, 0.04, "bandpass", 2200, 1, 0.12 * vol);
                if (Rnd() < 0.18) CreakAt(c, dest, t + 0.05, Rand(260, 380), 0.25, 0.08);
            }
            return 0.4;
        }, "footstep (made)", 0.9);
    }

    /// <summary>The foghorn far out on the river. Only in fog: in any other weather (or none yet) it stays silent.</summary>
    public void Foghorn()
    {
        if (weather != "fog") return;
        HornCount++;
        HornUsed();
        Log("foghorn");
        // out on the river, 180-260 m off the quays; it carries (low rolloff), a long wet tail; clearly far off
        // inland, and the house rows muffle it half
        var spot = NewSpot(listenerPos.X + Rand(-160, 160), 5, Rand(-260, -180), 15, 0.8, 900, 1.6, 14000, Bus("ambience"), double.PositiveInfinity, 0.5);
        MadeAt(spot, FoghornMake, "foghorn", 1, 0.15);
    }

    private static double FoghornMake(Wa c, Wa.Node dest, double t)
    {
        var lp = c.Biquad("lowpass", 520, 0.6);
        var env = c.Gain(0);
        lp.Connect(env).Connect(dest);
        // diaphone: long low tone, then the grunt drop at the end
        double f = Rand(92, 108);
        double hold = Rand(3.2, 4.4);
        foreach (var (mult, type, g, det) in new[] { (1.0, "sawtooth", 0.42, 0.0), (1, "square", 0.18, 6), (2, "sawtooth", 0.12, -4), (0.5, "sine", 0.35, 0) })
        {
            var o = c.Osc(type);
            o.Detune = det;
            o.Frequency.SetValueAtTime(f * mult * 0.94, t);
            o.Frequency.LinearRampToValueAtTime(f * mult, t + 0.35);
            o.Frequency.SetValueAtTime(f * mult, t + hold);
            o.Frequency.ExponentialRampToValueAtTime(f * mult * 0.7, t + hold + 0.7);
            var og = c.Gain(g);
            o.Connect(og).Connect(lp);
            o.Start(t);
            o.Stop(t + hold + 1.2);
        }
        env.G.SetValueAtTime(0, t);
        env.G.LinearRampToValueAtTime(FoghornGain, t + 0.6);
        env.G.SetValueAtTime(FoghornGain, t + hold);
        env.G.LinearRampToValueAtTime(FoghornGain * 0.8, t + hold + 0.5);
        env.G.LinearRampToValueAtTime(0, t + hold + 1.1);
        return hold + 1.2;
    }

    /// <summary>Gulls over the water near you (they follow the river, not you inland): a slice of the harbour recording, a few calls, faded in and out.</summary>
    public void Gulls()
    {
        if (!buf.TryGetValue("gulls", out var b)) return;
        // they keep over the water: a street or two inland they are gone, not heard over the roofs
        if (quayDist > 130) return;
        var spot = NewSpot(listenerPos.X + Rand(-40, 40), Rand(8, 18), Rand(-45, -8), 6, 1, 200, 0.9, 3200, Bus("ambience"), 160, 0);
        var span = Pick(Samples.GullSpans);
        double dur = Rand(3, 6);
        double start = Rand(span[0], Math.Max(span[0], span[1] - dur));
        double rate = Rand(0.94, 1.0);
        Add(spot, b, "gulls", 1, rate, start, dur + 0.05, 0.05, new Env((0, 0), (0.4, 0.9), (dur - 0.8, 0.9), (dur, 0)));
    }

    /// <summary>Rope and timber creak from a ship near you: the recorded pulley, or the made one when it is missing.</summary>
    public void Creak()
    {
        buf.TryGetValue("pulleyCreak", out var rec);
        var ship = Nearest("ship", 60);
        if (rec != null && ship != null)
        {
            double dur = Rand(1.8, 4);
            double start = Rand(0, Math.Max(0, rec.GetLength() - dur));
            Slice(rec, "rope creak", ship.X + Rand(-6, 6), ship.Y ?? 1, ship.Z, start, start + dur, 0.45, Rand(0.8, 1.0), 120, 4, 0, 70);
            return;
        }
        if (rec != null || shipPositions.Count == 0) return; // no ship near: no creak
        var p = shipPositions[(int)Math.Floor(Rnd() * shipPositions.Count) % shipPositions.Count];
        var sp = new Spot { Raw = true, Ref = 6, Rolloff = 0.9, Out = Bus("ambience"), X = p.X + Rand(-15, 15), Y = p.Y, Z = p.Z };
        spots.Add(sp);
        MadeAt(sp, (c, dest, t) =>
        {
            double d1 = Rand(0.6, 1.3), end = d1;
            CreakAt(c, dest, t, Rand(140, 240), d1, 0.22);
            if (Rnd() < 0.5)
            {
                double at = Rand(0.9, 1.6), d2 = Rand(0.4, 0.9);
                CreakAt(c, dest, t + at, Rand(160, 260), d2, 0.15);
                end = Math.Max(end, at + d2);
            }
            return end + 0.05;
        }, "rope creak (made)");
    }

    // ------------------------------------------------------------------ loading

    private AudioStream? Decode(string rel)
    {
        string path = Path.Combine(AudioPaths.Audio, rel);
        try
        {
            if (File.Exists(path))
            {
                AudioStream? s = Path.GetExtension(path).ToLowerInvariant() switch
                {
                    ".mp3" => AudioStreamMP3.LoadFromFile(path),
                    ".wav" => AudioStreamWav.LoadFromFile(path),
                    _ => AudioStreamOggVorbis.LoadFromFile(path),
                };
                if (s != null) return Unpacked(s, rel);
            }
        }
        catch (Exception e)
        {
            GD.PrintErr($"[sound] {rel}: {e.Message}");
        }
        failed.Add(rel);
        return null;
    }

    /// <summary>
    /// A short recording that is played once (a step, a thud, a bell) is decoded at the start and kept as plain
    /// samples: starting an Ogg stream costs the main thread about half a millisecond each time (its decoder is set
    /// up anew), starting plain samples next to nothing. The long ones and the loops stay Ogg (decoded as they play).
    /// </summary>
    private AudioStream Unpacked(AudioStream s, string rel)
    {
        double len = s.GetLength();
        if (rel.Contains("-loop") || len <= 0 || len > 8 || s is AudioStreamWav) return s;
        try
        {
            var pb = s.InstantiatePlayback();
            pb.Start(0);
            int want = (int)(len * mixRate) + 64, n = 0;
            var bytes = new byte[want * 2];
            while (n < want)
            {
                var a = pb.MixAudio(1, Math.Min(8192, want - n));
                if (a.Length == 0) break;
                for (int i = 0; i < a.Length; i++)
                {
                    short v = (short)Math.Clamp(Math.Round((a[i].X + a[i].Y) * 0.5f * 32767), -32768, 32767);
                    bytes[(n + i) * 2] = (byte)v;
                    bytes[(n + i) * 2 + 1] = (byte)(v >> 8);
                }
                n += a.Length;
            }
            pb.Stop();
            if (n < mixRate / 100) return s;
            unpacked++;
            return new AudioStreamWav { Format = AudioStreamWav.FormatEnum.Format16Bits, MixRate = mixRate, Stereo = false, Data = bytes.AsSpan(0, n * 2).ToArray() };
        }
        catch (Exception e)
        {
            GD.PrintErr($"[sound] {rel}: kept as Ogg ({e.Message})");
            return s;
        }
    }
    private int unpacked;

    /// <summary>The recordings. A file that fails stays silent. The "-loop" files loop cleanly.</summary>
    private void LoadAll()
    {
        foreach (var (name, rel) in Samples.Files)
        {
            var s = Decode(rel);
            if (s == null) continue;
            if (rel.Contains("-loop") && s is AudioStreamOggVorbis ogg) ogg.Loop = true;
            buf[name] = s;
        }
        foreach (string surface in new[] { "stone", "wood" })
            for (int n = 0; n < 5; n++)
            {
                var s = Decode(Samples.StepFile(surface, n));
                if (s != null) steps[surface].Add(s);
            }
        // one-shot job sounds, all recorded
        foreach (var (name, files) in Samples.Fx)
        {
            var set = new List<AudioStream>();
            foreach (string f in files)
            {
                var s = Decode(f);
                if (s != null) set.Add(s);
            }
            fx[name] = set;
        }
        // the thunderclaps (the storm's part takes them through AliveSounds.Thunder)
        AliveSounds.RecordedNear.Clear();
        AliveSounds.RecordedFar.Clear();
        foreach (var (ids, list, tag) in new[] { (Samples.ThunderNear, AliveSounds.RecordedNear, "thunderNear"), (Samples.ThunderFar, AliveSounds.RecordedFar, "thunderFar") })
            for (int i = 0; i < ids.Length; i++)
            {
                var s = Decode(Samples.ThunderFile(ids[i]));
                if (s == null) continue;
                buf[$"{tag}{i}"] = s;
                list.Add($"{tag}{i}");
            }
    }

    /// <summary>The great storm's beds, when the first storm comes: the gale and the downpour in the street, the storm as it is heard from inside a room, and the made downpour under them.</summary>
    private void LoadStorm()
    {
        Spot StormBed(string name, string bus)
        {
            var sp = Bed(bus, 0, 1.2);
            if (buf.TryGetValue(name, out var b)) Add(sp, b, name, 1, from: Rnd() * b.GetLength());
            return sp;
        }
        stormBeds = (StormBed("galeTrees", "Ambience"), StormBed("rainHeavy", "Ambience"), StormBed("windInside", "RoomAmbience"));
        downpourSpot = Bed("Ambience", 0, 1.5);
        int rate = mixRate;
        Task.Run(() =>
        {
            try
            {
                // the great storm's downpour in the open: broad noise, a hiss with body
                var w = RenderLoop(c => { LoopNoise(c, White, "bandpass", 2600, 0.35, 0.9, 3 / 43.0); LoopNoise(c, Brown, "lowpass", 700, 0.5, 0.5, 2 / 43.0); return 0; }, rate, 43);
                ready.Enqueue(() =>
                {
                    downpourLoop = w;
                    Add(downpourSpot, w.stream, "downpour", w.scale, from: Rnd() * 30);
                });
            }
            catch (Exception e)
            {
                GD.PrintErr($"[sound] the downpour: {e}");
            }
        });
        StartHowl();
    }

    /// <summary>
    /// Play a job sound: "thud_wood", "thud_soft", "thud_plank", "splash", "bell"; "lift" and "coins" reuse the thuds,
    /// played soft and high. With a position it sits in the world; without, it is far off.
    /// </summary>
    public void Play(string name, Vector3? at = null)
    {
        string key = name;
        double rate = Rand(0.9, 1.05);
        double vol = 0.9;
        if (name == "lift") (key, rate, vol) = ("thud_soft", Rand(1.3, 1.5), 0.35);
        if (name == "coins") (key, rate, vol) = ("thud_plank", Rand(2.6, 3.0), 0.25);
        if (!fx.TryGetValue(key, out var set) || set.Count == 0) return;
        var b = set[(int)Math.Floor(Rnd() * set.Count) % set.Count];
        bool bell = name == "bell";
        double pitch = bell ? 1 : rate;
        double g = bell ? 0.5 : vol;
        if (at != null && at.Value.IsFinite())
        {
            var spot = NewSpot(at.Value.X, at.Value.Y, at.Value.Z, 2, 1.1, 150, bell ? 1.2 : 0.3, 14000, Bus("effects"), bell ? 120 : 60);
            Add(spot, b, name, g, pitch, 0, b.GetLength() / pitch + 0.1);
        }
        else
        {
            // far off in the fog: dull it down
            var flat = FlatSpot(Bus("effects"), bell ? 1800 : 6000, bell ? 1.2 : 0.3);
            Add(flat, b, name, g, pitch, 0, b.GetLength() / pitch + 0.1);
        }
    }

    public bool GullsLoaded => buf.ContainsKey("gulls");
    public int StepSamples => steps["stone"].Count + steps["wood"].Count;

    // ------------------------------------------------------------------ made in code

    /// <summary>Rope or timber creak: friction pulses through a resonant filter.</summary>
    private static void CreakAt(Wa c, Wa.Node dest, double t, double f, double dur, double vol)
    {
        var o = c.Osc("sawtooth");
        o.Frequency.SetValueAtTime(f * 0.12, t);
        o.Frequency.LinearRampToValueAtTime(f * 0.08 * Rand(0.8, 1.5), t + dur);
        var bp = c.Biquad("bandpass", 350, 9);
        bp.Frequency.SetValueAtTime(f * 4, t);
        bp.Frequency.LinearRampToValueAtTime(f * 3.2, t + dur);
        var env = c.Gain();
        env.G.SetValueAtTime(0, t);
        env.G.LinearRampToValueAtTime(vol, t + dur * 0.3);
        env.G.LinearRampToValueAtTime(0, t + dur);
        o.Connect(bp).Connect(env).Connect(dest);
        o.Start(t);
        o.Stop(t + dur + 0.05);
    }

    /// <summary>Water slapping the stone: one of the laps built at the start, at the water's place.</summary>
    private void Lap()
    {
        if (lapBank.Count == 0) return;
        var (stream, scale) = lapBank[(int)Math.Floor(Rnd() * lapBank.Count) % lapBank.Count];
        Add(waterSpot, stream, "lap", scale * Rand(0.25, 0.6), Rand(0.95, 1.05));
    }

    /// <summary>A swim stroke: an arm through the water, then the wash (made in code).</summary>
    public void SwimStroke()
    {
        var flat = FlatSpot(Bus("effects"));
        MadeAt(flat, (c, dest, t) =>
        {
            double a = Rand(0.35, 0.55), b = Rand(0.3, 0.45);
            Burst(c, dest, t, a, "bandpass", Rand(500, 900), 1.2, 0.35, 0.08);
            Burst(c, dest, t + 0.14, b, "lowpass", Rand(350, 480), 0.7, 0.3, 0.05);
            return Math.Max(a, 0.14 + b) + 0.03;
        }, "swim stroke", 0.7);
    }

    private static void Burst(Wa c, Wa.Node dest, double t, double dur, string type, double freq, double q, double vol, double attack = 0.002)
    {
        var src = c.Noise();
        src.PlaybackRate = Rand(0.9, 1.1);
        var f = c.Biquad(type, freq, q);
        var env = c.Gain();
        env.G.SetValueAtTime(0, t);
        env.G.LinearRampToValueAtTime(vol, t + attack + dur * 0.05);
        env.G.ExponentialRampToValueAtTime(0.001, t + dur);
        src.Connect(f).Connect(env).Connect(dest);
        src.Start(t, Rnd() * 2);
        src.Stop(t + dur + 0.02);
    }

    private static void Thump(Wa c, Wa.Node dest, double t, double f, double dur, double vol)
    {
        var o = c.Osc("sine");
        o.Frequency.SetValueAtTime(f * 1.6, t);
        o.Frequency.ExponentialRampToValueAtTime(f, t + 0.03);
        var env = c.Gain();
        env.G.SetValueAtTime(0, t);
        env.G.LinearRampToValueAtTime(vol, t + 0.004);
        env.G.ExponentialRampToValueAtTime(0.001, t + dur);
        o.Connect(env).Connect(dest);
        o.Start(t);
        o.Stop(t + dur + 0.02);
    }

    /// <summary>A noise bed with a slow swell so it breathes (the browser's loopNoise), into the destination.</summary>
    private static void LoopNoise(Wa c, float[] noise, string type, double freq, double q, double vol, double swellHz)
    {
        var src = c.Src(noise, NoiseRate);
        src.Loop = true;
        var f = c.Biquad(type, freq, q);
        var g = c.Gain(vol);
        var lfo = c.Osc("sine", swellHz);
        var lg = c.Gain(vol * 0.45);
        lfo.Connect(lg).Connect(g.G);
        src.Connect(f).Connect(g).Connect(c.Destination);
        src.Start(0, Rnd() * (noise.Length / (double)NoiseRate));
        lfo.Start(0);
    }

    // ------------------------------------------------------------------ the great storm's howl (it changes while it plays)

    private AudioStreamPlayer? howlPlayer;
    private AudioStreamGeneratorPlayback? howlPlayback;
    private double howlGain, howlGainT, howlF0 = 520, howlF1 = 1150, howlPos0, howlPos1, howlPos2;
    private readonly double[] howlState = new double[12];
    private Vector2[] howlBuf = new Vector2[2048];

    private void StartHowl()
    {
        if (howlPlayer != null) return;
        howlPlayer = new AudioStreamPlayer { Stream = new AudioStreamGenerator { MixRate = mixRate, BufferLength = 0.15f }, Bus = "Ambience" };
        flatHolder.AddChild(howlPlayer);
        howlPos2 = White.Length / 2; // (the two bands read the noise at different places)
    }

    /// <summary>A low roar and two narrow howling bands whose pitch wanders and bends up with the gust: built as it plays, only while a storm blows.</summary>
    private void FeedHowl(double dt)
    {
        if (howlPlayer == null) return;
        howlGain = Toward(howlGain, howlGainT, 0.35, dt);
        if (howlGain < 1e-4)
        {
            if (howlPlayer.Playing) howlPlayer.Stop();
            howlPlayback = null;
            return;
        }
        if (!howlPlayer.Playing)
        {
            howlPlayer.Play();
            howlPlayback = (AudioStreamGeneratorPlayback)howlPlayer.GetStreamPlayback();
        }
        // the howl bends up with the gust and wanders on its own
        double w = Math.Sin(now * 0.37) * 0.5 + Math.Sin(now * 0.13 + 1) * 0.5;
        howlF0 = Toward(howlF0, 480 * (1 + 0.25 * w + 0.35 * tempestGust), 0.4, dt);
        howlF1 = Toward(howlF1, 1050 * (1 + 0.2 * w + 0.3 * tempestGust), 0.4, dt);
        int n = Math.Min(howlPlayback!.GetFramesAvailable(), howlBuf.Length);
        if (n <= 0) return;
        var lp = BiquadCoefs("lowpass", 260, 0.6, 0, mixRate);
        var b0 = BiquadCoefs("bandpass", howlF0, 11, 0, mixRate);
        var b1 = BiquadCoefs("bandpass", howlF1, 16, 0, mixRate);
        double step = (double)NoiseRate / mixRate;
        var s = howlState;
        float g = (float)howlGain;
        for (int i = 0; i < n; i++)
        {
            double xb = Brown[(int)howlPos0], x0 = White[(int)howlPos1], x1 = White[(int)howlPos2];
            howlPos0 += step; if (howlPos0 >= Brown.Length) howlPos0 -= Brown.Length;
            howlPos1 += step; if (howlPos1 >= White.Length) howlPos1 -= White.Length;
            howlPos2 += step; if (howlPos2 >= White.Length) howlPos2 -= White.Length;
            double ya = lp.b0 * xb + s[0]; s[0] = lp.b1 * xb - lp.a1 * ya + s[1]; s[1] = lp.b2 * xb - lp.a2 * ya;
            double yb = b0.b0 * x0 + s[2]; s[2] = b0.b1 * x0 - b0.a1 * yb + s[3]; s[3] = b0.b2 * x0 - b0.a2 * yb;
            double yc = b1.b0 * x1 + s[4]; s[4] = b1.b1 * x1 - b1.a1 * yc + s[5]; s[5] = b1.b2 * x1 - b1.a2 * yc;
            float y = (float)(ya * 0.55 + yb * 0.5 + yc * 0.22) * g;
            howlBuf[i] = new Vector2(y, y);
        }
        howlPlayback.PushBuffer(howlBuf.AsSpan(0, n));
    }
}

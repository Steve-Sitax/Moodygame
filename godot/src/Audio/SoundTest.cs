using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using static Scheldemist.Audio.Wa;

namespace Scheldemist.Audio;

/// <summary>
/// The sound's self-test: `-- --soundtest dir`. Plays every trigger once by script, then the layers at three hours,
/// in rain and in the great storm; records the master bus (the speaker is muted after the recorder, so nothing is
/// heard) to dir/soundtest.wav; writes per sound whether it played, its peak and RMS in the recording, its length,
/// and what the browser's code says it should be, to dir/soundtest.json; quits.
/// </summary>
public partial class Soundscape
{
    private SoundTester? test;
    private void StartTest(string dir) => test = new SoundTester(this, dir);
    private void TestTick() => test?.Tick();
    private void TestPlaceCamera() => test?.PlaceCamera();

    // Exercise real concurrent publication and per-worker ordering. This runs after recording, outside play.
    private static bool CheckReadyQueue()
    {
        const int workers = 4, count = 1024;
        var queue = new ReadyQueue();
        var next = new int[workers];
        int received = 0;
        bool ordered = true;
        var writers = new System.Threading.Tasks.Task[workers];
        for (int p = 0; p < workers; p++)
        {
            int producer = p;
            writers[p] = System.Threading.Tasks.Task.Run(() =>
            {
                for (int i = 0; i < count; i++)
                {
                    int value = i;
                    queue.Enqueue(() => { ordered &= next[producer]++ == value; received++; });
                }
            });
        }
        var watch = System.Diagnostics.Stopwatch.StartNew();
        while (received < workers * count && watch.Elapsed.TotalSeconds < 5)
        {
            if (queue.TryDequeue(out var fn)) fn();
            else System.Threading.Thread.Yield();
        }
        return ordered && received == workers * count && System.Threading.Tasks.Task.WaitAll(writers, 1000) && !queue.TryDequeue(out _);
    }

    private Dictionary<string, bool> WiringChecks()
    {
        var checks = new Dictionary<string, bool>
        {
            ["Jef's step and swim hooks"] = wiredJef,
            ["bubble voice hook"] = wiredBubbles && Scheldemist.Talks.Bubbles.I?.Speak != null,
            ["dice sound hook"] = wiredDice && Scheldemist.Talks.Dice.I?.Sfx != null,
            ["stone bridge over water"] = !TimberAt(-76, 100),
            ["timber pier"] = TimberAt(7, -5),
            ["timber pontoon"] = TimberAt(-249, -20),
            ["timber deck"] = TimberAt(-40, -7),
            ["timber gangway"] = TimberAt(-42, -1),
            ["street outside the timber"] = !TimberAt(12, 12),
            ["baked rooms found"] = rooms.Count > 0,
            ["baked taverns found"] = rooms.Any(r => r.kind == "tavern"),
            ["baked shops found"] = rooms.Any(r => r.kind == "shop"),
            ["speakers stayed muted"] = Speaker == 0,
            ["worker callbacks preserve FIFO under contention"] = CheckReadyQueue(),
        };
        if(LifeSound.I is {} life)foreach(var pair in life.WiringChecks())checks[pair.Key]=pair.Value;
        else checks["life producer hooks loaded"]=false;
        foreach (var room in rooms)
        {
            var local = room.box.GetCenter();
            local.Y = room.box.Position.Y + 0.3f;
            var p = room.inverse.AffineInverse() * local;
            checks[$"baked {room.kind} at {p.X:0.0}, {p.Z:0.0}"] = BakedInterior(p) == room.kind;
        }
        // Check the real settings buses, including mute and the reverb path, then put their levels back.
        foreach (string k in Kinds)
        {
            int source = busIndex[Cap(k)], room = busIndex["Room" + Cap(k)];
            float db = AudioServer.GetBusVolumeDb(source);
            bool mute = AudioServer.IsBusMute(source);
            AudioServer.SetBusVolumeDb(source, -12);
            AudioServer.SetBusMute(source, true);
            FollowVolumes();
            checks[k + " room mute and echo mute"] = AudioServer.IsBusMute(room) && wetLevels[Cap(k)] == 0;
            AudioServer.SetBusMute(source, false);
            FollowVolumes();
            checks[k + " room level and echo level"] = Math.Abs(AudioServer.GetBusVolumeDb(room) + 12) < 0.01 && Math.Abs(wetLevels[Cap(k)] - Math.Pow(10, -12.0 / 20)) < 0.001;
            checks[k + " sends through the street"] = AudioServer.GetBusSend(source) == "Street";
            AudioServer.SetBusVolumeDb(source, db);
            AudioServer.SetBusMute(source, mute);
        }
        FollowVolumes();
        var savedTest = test;
        bool heldHour = ownHour, heldWeather = ownWeather;
        double? savedClock = clock;
        string? savedWeather = weather;
        test = null;
        ownHour = ownWeather = false;
        StateClock();
        StateWeather(Scheldemist.Game.GameState.I.Weather);
        checks["store clock"] = Math.Abs((clock ?? -1) - Scheldemist.Game.GameState.I.HourF) < 0.01;
        checks["store weather"] = weather == Scheldemist.Game.GameState.I.Weather;
        ownHour = ownWeather = true;
        clock = 5;
        weather = "fog";
        StateClock();
        StateWeather("storm");
        checks["command line clock and weather keep their own"] = clock == 5 && weather == "fog";
        (test, ownHour, ownWeather, clock, weather) = (savedTest, heldHour, heldWeather, savedClock, savedWeather);
        timers.Clear();
        return checks;
    }

    /// <summary>Everything the test started goes quiet; the beds stay.</summary>
    private void Silence(HashSet<Spot> keep)
    {
        foreach (var sp in spots.ToArray()) if (!keep.Contains(sp)) DropSpot(sp);
        timers.Clear();
        foreach (var l in live) (l.Voice, l.Level) = (null, 0);
        foreach (var c in carts) c.Voice = null;
        vehicles.Clear();
        shipSounds.Clear();
        crowdSpots.Clear();
        roomBeds.Clear();
        (stepStone, stepWood, splashSoft, splashHard, organSpot) = (null, null, null, null, null);
        organOn = organWanted = false;
        roomKind = null;
        hallVerb.Wet = 0;
        organVerb.Wet = 0;
        streetIn = (0.9, 20000);
        (streetGainT, streetLpT, streetGain, streetLp) = (0.9, 20000, 0.9, 20000);
        AudioServer.SetBusVolumeDb(busIndex["Street"], Db(0.9));
        streetLpFx.CutoffHz = 20000;
        hornOkAt = 0;
        people = Array.Empty<Vector2>();
        crowdN = 0;
    }

    /// <summary>The smoothed levels jump to where they are going (the test does not wait for them).</summary>
    private void Settle()
    {
        SlowTick();
        foreach (var sp in spots)
        {
            sp.Level = sp.LevelT;
            (sp.Fog, sp.Lp, sp.Wet) = sp.Flat || sp.Raw ? (sp.Fog, sp.Lp, sp.Wet) : (sp.FogT, sp.LpT, sp.WetT);
            foreach (var v in sp.Voices) v.Level = v.LevelT;
        }
        howlGain = howlGainT;
    }

    private sealed class SoundTester
    {
        private sealed class Item
        {
            public string Name = "", Group = "";
            public Action Do = () => { };
            public double Listen = 1.4;
            /// <summary>The browser's source gain and length (seconds), as ranges read from its code; NaN: not given.</summary>
            public double GainMin = double.NaN, GainMax = double.NaN, SecMin = double.NaN, SecMax = double.NaN;
            public double T0, T1;
            public readonly List<Dictionary<string, object?>> Voices = new();
            public double Expected, ExpectedSum, W0, W1, CallMs;
            public bool Filtered, Approx;
            public Dictionary<string, object?> Extra = new();
            public Action<Item>? After;
        }

        private readonly Soundscape s;
        private readonly string dir;
        private readonly List<Item> items = new();
        private readonly HashSet<Spot> keep = new();
        private AudioEffectRecord rec = null!;
        private int at = -1;
        private double next, recStart;
        private bool gap, done, skipLayers;
        private Item? cur;
        private double wallEnd;
        private readonly Vector3 L = new(-118, 1.7f, 12);
        private Vector3 pos = new(-118, 1.7f, 12);
        private AudioStreamWav sine = null!, noise = null!;
        private double noiseRms;
        private readonly List<double> frameCosts = new(36000);
        private readonly List<object> overBudget = new();
        private double callCost;
        private double frameCallCost;
        private string callName = "none";
        private readonly double[] lastProf = new double[ProfNames.Length];
        public double TakeCallCost() { frameCallCost = callCost; callCost = 0; return frameCallCost; }
        public void FrameCost(double ms, int gc0, int gc1, int gc2)
        {
            frameCosts.Add(ms);
            if (ms <= 0.3) { Array.Copy(s.prof, lastProf, lastProf.Length); return; }
            var starts = s.prof.Select((p, i) => Math.Round(p - lastProf[i], 4)).ToArray();
            Array.Copy(s.prof, lastProf, lastProf.Length);
            var steps = FrameSteps.Select((n, i) => new { step = n, ms = Math.Round(s.frameSteps[i], 4) }).ToArray();
            var row = new { frame = frameCosts.Count, at_s = Math.Round(s.now, 3), ms = Math.Round(ms, 4),
                trigger = callName != "none" ? callName : cur?.Name ?? (at < 0 ? "startup" : "gap/layers"), sound = s.frameSound, steps,
                trigger_ms = Math.Round(frameCallCost, 4),
                starts = ProfNames.Select((n, i) => new { step = n, ms = starts[i] }).ToArray(),
                gc = new[] { GC.CollectionCount(0) - gc0, GC.CollectionCount(1) - gc1, GC.CollectionCount(2) - gc2 } };
            overBudget.Add(row);
            GD.Print("sound over budget: " + JsonSerializer.Serialize(row));
        }
        private int calBus = -1;
        private AudioStreamPlayer clock = null!;
        private double clockLast, clockBase;
        private readonly List<(Item it, Spot sp, V v, double raw, double level0)> watch = new();

        /// <summary>
        /// The recording's own time: where a silent loop has got to. (The game's clock and the sound's drift apart;
        /// without a sound card, in a headless run, by a second a minute.)
        /// </summary>
        private double A()
        {
            double p = clock.GetPlaybackPosition();
            if (p < clockLast - 1) clockBase += 2;
            clockLast = p;
            return clockBase + p;
        }
        private AudioEffectReverb calVerb = null!;
        private AudioStreamPlayer? calPlayer;

        private Vector3 Front(double d, double y = 1.7) => new(L.X, (float)y, (float)(L.Z - d));

        public SoundTester(Soundscape s, string dir)
        {
            this.s = s;
            this.dir = dir;
            // Jef normally puts his eyes back over his feet each frame. This test owns the listener instead.
            Scheldemist.Player.Jef.I?.SetProcess(false);
            Directory.CreateDirectory(dir);
            s.Auto = false;
            s.Chance = false;
            Engine.MaxFps = 60;
            // the recorder is the master bus's last effect; the bus is muted after its effects: nothing reaches the speaker
            rec = new AudioEffectRecord { Format = AudioStreamWav.FormatEnum.Format16Bits };
            AudioServer.AddBusEffect(0, rec);
            s.Speaker = 0;
            AudioServer.SetBusMute(s.busIndex["Reverb"], true);
            foreach (var sp in s.spots) keep.Add(sp);
            s.SetWeather("clear");
            s.SetClock(13);
            s.SetRain(0);
            // a tone and a noise of known level
            int r = s.mixRate;
            var tone = new float[(int)(r * 0.6)];
            for (int i = 0; i < tone.Length; i++) tone[i] = (float)(ToneLevel * Math.Sin(2 * Math.PI * 440 * i / r) * Math.Min(1, Math.Min(i, tone.Length - 1 - i) / (0.01 * r)));
            sine = ToWav(tone, r).stream!;
            var nz = new float[r * 2];
            var rng = new Random(7);
            double sum = 0;
            for (int i = 0; i < nz.Length; i++)
            {
                nz[i] = (float)((rng.NextDouble() * 2 - 1) * 0.25);
                sum += nz[i] * nz[i];
            }
            // (the stream is scaled to nearly full level; it is played 20 dB down)
            var nw = ToWav(nz, r);
            noiseRms = Math.Sqrt(sum / nz.Length) / nw.scale * 0.1;
            noise = nw.stream!;
            calVerb = new AudioEffectReverb { Dry = 0, Wet = 1, Damping = 0.6f, Spread = 1, Hipass = 0, PredelayMsec = 20, PredelayFeedback = 0 };
            calBus = AudioServer.BusCount;
            AudioServer.AddBus();
            AudioServer.SetBusName(calBus, "Cal");
            AudioServer.SetBusSend(calBus, "Master");
            AudioServer.AddBusEffect(calBus, calVerb);
            clock = new AudioStreamPlayer { Stream = new AudioStreamWav { Format = AudioStreamWav.FormatEnum.Format8Bits, MixRate = 8000, Stereo = false, Data = new byte[16000], LoopMode = AudioStreamWav.LoopModeEnum.Forward, LoopBegin = 0, LoopEnd = 16000 } };
            s.AddChild(clock);
            clock.Play();
            Build();
            string only = Main.I.Arg("soundtest-only");
            if (only != "")
            {
                var groups = only.Split(',');
                items.RemoveAll(i => !groups.Contains(i.Group));
                skipLayers = !groups.Contains("layers");
            }
            GD.Print($"sound test: {items.Count} rows, about {items.Sum(i => i.Listen + 0.3):0} s; nothing is heard (the master bus is muted after the recorder)");
        }

        private void Add(string group, string name, Action fn, double listen = 1.4, double g0 = double.NaN, double g1 = double.NaN, double s0 = double.NaN, double s1 = double.NaN, Action<Item>? after = null)
            => items.Add(new Item { Group = group, Name = name, Do = fn, Listen = listen, GainMin = g0, GainMax = double.IsNaN(g1) ? g0 : g1, SecMin = s0, SecMax = double.IsNaN(s1) ? s0 : s1, After = after });

        /// <summary>The test tone's level: under the compressor's threshold.</summary>
        private const double ToneLevel = 0.05;
        private void Tone(Spot sp) => s.Add(sp, sine, "tone", ToneLevel / 0.95);

        private void Build()
        {
            Add("wiring", "Jef's step hook", () => s.onStep?.Invoke(false), 0.9);
            Add("wiring", "Jef's landing hook", () => s.onLand?.Invoke(), 0.9);
            Add("wiring", "bubble voice hook", () => Scheldemist.Talks.Bubbles.I?.Speak?.Invoke(Front(2), "m", 35, 1), 1.5);
            Add("wiring", "dice sound hook", () => Scheldemist.Talks.Dice.I?.Sfx?.Invoke("thud_wood"), 0.9);
            Add("life", "live horse snort producer",()=>LifeAnimalSounds.Snort(Front(3,1.5)),1.2);
            Add("life", "cat threat hiss producer", () => LifeAnimalSounds.Hiss(L.X,L.Z-2), 1.2);
            Add("life", "bird flight wings producer", () => LifeAnimalSounds.Wings(L.X,.5,L.Z-2), 1.5);
            var v = L;
            // ---- what Godot does to a sound of known level (the numbers PanMakeup and the reverb's level come from)
            Add("measure", "tone at the ear (no place)", () => Tone(s.FlatSpot("Effects")), 0.9);
            foreach (var (name, dx, dz) in new[] { ("ahead", 0.0, -2.0), ("to the right", 2.0, 0.0), ("behind", 0.0, 2.0), ("to the left", -2.0, 0.0), ("ahead and right", 1.414, -1.414), ("ahead and left", -1.414, -1.414), ("behind and right", 1.414, 1.414), ("behind and left", -1.414, 1.414) })
                Add("measure", $"tone 2 m {name}", () =>
                {
                    var sp = new Spot { Raw = true, Ref = 4, Rolloff = 1, X = L.X + dx, Y = L.Y, Z = L.Z + dz, Out = "Effects" };
                    s.spots.Add(sp);
                    Tone(sp);
                }, 0.9);
            Add("measure", "tone 40 m ahead (ref 4, rolloff 1.2: 0.0847)", () =>
            {
                var sp = new Spot { Raw = true, Ref = 4, Rolloff = 1.2, X = L.X, Y = L.Y, Z = L.Z - 40, Out = "Effects" };
                s.spots.Add(sp);
                Tone(sp);
            }, 0.9);
            foreach (double room in new[] { 0.0, 0.2, 0.4, 0.6, 0.75, 0.85, 0.92 })
                Add("measure", $"reverb, room size {room:0.00}", () =>
                {
                    calVerb.RoomSize = (float)room;
                    calPlayer = new AudioStreamPlayer { Stream = noise, Bus = "Cal", VolumeDb = -20 };
                    s.AddChild(calPlayer);
                    calPlayer.Play();
                }, 4.6, after: it =>
                {
                    calPlayer?.QueueFree();
                    calPlayer = null;
                });

            // one sharp recording four ways: at the ear or at a place, with or without the place's lowpass (14 kHz)
            foreach (var (name, place, lowpass) in new[] { ("at the ear", false, false), ("at the ear, lowpass 14 kHz", false, true), ("2 m ahead", true, false), ("2 m ahead, lowpass 14 kHz", true, true) })
                Add("measure", $"thud {name}", () =>
                {
                    Spot sp;
                    if (!place) sp = s.FlatSpot("Effects", lowpass ? 14000 : 0);
                    else if (lowpass) sp = s.NewSpot(L.X, L.Y, L.Z - 2, 4, 1, 150, 0, 14000, "Effects", 150, 0);
                    else
                    {
                        sp = new Spot { Raw = true, Ref = 4, Rolloff = 1, X = L.X, Y = L.Y, Z = L.Z - 2, Out = "Effects" };
                        s.spots.Add(sp);
                    }
                    s.Add(sp, s.fx["thud_wood"][0], "thud", 0.25);
                }, 0.9);

            // how a sound begins: equal bursts 10 ms apart from its first sample, at the ear and at a place
            foreach (bool place in new[] { false, true })
                Add("measure", place ? "onset 2 m ahead" : "onset at the ear", () =>
                {
                    int r = s.mixRate;
                    var d = new float[(int)(r * 0.2)];
                    for (int k = 0; k < 16; k++)
                        for (int i = 0; i < r * 0.003; i++) d[(int)(k * 0.01 * r) + i] = (float)(0.5 * Math.Sin(2 * Math.PI * 3000 * i / r));
                    var w = ToWav(d, r);
                    Spot sp;
                    if (!place) sp = s.FlatSpot("Effects");
                    else
                    {
                        sp = new Spot { Raw = true, Ref = 4, Rolloff = 1, X = L.X, Y = L.Y, Z = L.Z - 2, Out = "Effects" };
                        s.spots.Add(sp);
                    }
                    s.Add(sp, w.stream!, "onset", w.scale * (place ? 0.2 / 0.7071 : 0.2));
                }, 0.9);

            // the reverbs as they are set, against the browser's convolver (its level for noise, and where its impulse has fallen 60 dB)
            foreach (var (name, bus, seconds, level) in new[] { ("outdoors", "Reverb", 3.5, ConvolverGain(3.8) * 0.55 * 0.9), ("room", "Room", 0.52, 0.22 * ConvolverGain(0.7)), ("church", "Room", 4.8 * (1 - Math.Pow(10, -3 / 2.2)), 0.62 * ConvolverGain(4.8)) })
                Add("measure", $"reverb as set: {name}", () =>
                {
                    if (name == "church") s.SetInterior("church");
                    (name == "room" ? s.roomVerb : s.hallVerb).Dry = 0;
                    if (name == "church") s.roomVerb.Wet = 0;
                    if (name == "room") s.hallVerb.Dry = 1;
                    AudioServer.SetBusMute(s.busIndex["Reverb"], false);
                    calPlayer = new AudioStreamPlayer { Stream = noise, Bus = bus, VolumeDb = -20 };
                    s.AddChild(calPlayer);
                    calPlayer.Play();
                    cur!.Extra["browser"] = new[] { Math.Round(level, 4), Math.Round(seconds, 2) };
                }, 5.2, after: it =>
                {
                    calPlayer?.QueueFree();
                    calPlayer = null;
                    s.roomVerb.Dry = 1;
                    s.hallVerb.Dry = 1;
                    SetVerb(s.roomVerb, 0.52, 0.22 * ConvolverGain(0.7));
                    AudioServer.SetBusMute(s.busIndex["Reverb"], true);
                });

            // ---- Jef and the jobs
            Add("jef", "footstep, stone", () => s.Step("stone"), 0.8, 0.9 * 0.65 * 0.8, 0.9 * 0.65);
            Add("jef", "footstep, wood", () => s.Step("wood"), 0.8, 0.9 * 0.8 * 0.8, 0.9 * 0.8);
            Add("jef", "footstep, stone, hurried", () => s.Footstep("stone", true), 0.8, 0.9 * 0.65 * 1.25 * 0.8, 0.9 * 0.65 * 1.25);
            Add("jef", "footstep in a puddle", () => s.Footstep("stone", false, 0.8), 0.9);
            Add("jef", "boot in a puddle", () => s.SplashStep(false, 1), 0.9, 0.7 * 0.3 * 0.85, 0.7 * 3.0, 0.3, 0.5);
            Add("jef", "footstep in a room", () => s.Indoors(() => s.Step("stone")), 0.8, 0.9 * 0.65 * 0.8, 0.9 * 0.65);
            Add("jef", "swim stroke", () => s.SwimStroke(), 1.1, 0.7, 0.7, 0.38, 0.62);
            foreach (var (name, g) in new[] { ("thud_wood", 0.9), ("thud_soft", 0.9), ("thud_plank", 0.9), ("lift", 0.35), ("coins", 0.25), ("splash", 0.9), ("bell", 0.5) })
                Add("jobs", $"play {name}, 4 m ahead", () => s.Play(name, Front(4)), name is "splash" or "bell" ? 2 : 0.9, g);
            Add("jobs", "play bell, far off (no place)", () => s.Play("bell"), 2, 0.5);
            Add("jobs", "play thud_wood, far off (no place)", () => s.Play("thud_wood"), 0.9, 0.9);

            // ---- voices and street trades
            Add("voices", "speech, a man", () => s.Speech(L.X, L.Z - 3, new VoiceOf("m", 35), 1.5), 2.2, 0.16, 0.16, 1.5, 1.9);
            Add("voices", "speech, a woman", () => s.Speech(L.X, L.Z - 3, new VoiceOf("f", 30), 1.5), 2.2, 0.16, 0.16, 1.5, 1.9);
            Add("voices", "speech, a child", () => s.Speech(L.X, L.Z - 3, new VoiceOf("m", 9), 1.5), 2.2, 0.16, 0.16, 1.5, 1.9);
            Add("voices", "speech, an old man", () => s.Speech(L.X, L.Z - 3, new VoiceOf("m", 70), 1.5), 2.2, 0.16, 0.16, 1.5, 1.9);
            foreach (var (id, cry) in Cries.All)
            {
                double secs = cry.Notes.Sum(n => n.Beats) * cry.Beat;
                Add("voices", $"street cry: {id}", () => s.Sing(L.X, L.Z - 4, new VoiceOf(id is "milk_woman" ? "f" : "m", id == "baker_boy" ? 11 : 40), cry.Notes, cry.Beat), secs + 0.5, 0.2, 0.2, secs, secs + 0.1);
            }
            foreach (string k in new[] { "grind", "rattle", "clink", "scrub" })
                Add("voices", $"street work: {k}", () => s.StreetWork(k, L.X, L.Z - 4, 1.5), 2.2, k == "scrub" ? 0.12 : 0.22, double.NaN, 1.5, k == "clink" ? 1.9 : 1.8);

            // ---- the clock, the bells
            Add("bells", "hour stroke (strike 2)", () => s.Strike(2), 4.2, 1.1);
            Add("bells", "carillon, short phrase", () => s.Carillon(true), 2.5, 0.9, 0.9, 10.5, 10.55);
            Add("bells", "carillon, whole tune", () => s.Carillon(false), 2.5, 0.9);
            Add("bells", "the clock crosses 10:00 (tune, then 10 strokes; watch bells)", () => { s.SetClock(9.99); s.SetClock(10.01); }, 2.5, after: it => { it.Extra["rung"] = s.Rung.TakeLast(3).ToArray(); s.SetClock(13); });
            Add("bells", "the clock crosses 10:30 (short phrase; watch bells)", () => { s.SetClock(10.49); s.SetClock(10.51); }, 2.5, after: it => { it.Extra["rung"] = s.Rung.TakeLast(2).ToArray(); s.SetClock(13); });
            Add("bells", "the clock crosses 23:00 (night: no tower bells)", () => { s.SetClock(22.99); s.SetClock(23.01); }, 1.0, after: it => { it.Extra["rung"] = s.Rung.TakeLast(1).ToArray(); it.Extra["quietTower"] = !it.Voices.Any(q => ((string)q["what"]!).Contains("carillon") || ((string)q["what"]!).Contains("stroke")); s.SetClock(13); });
            Add("bells", "watch bells (4)", () => s.WatchBells(4), 6, 0.55);
            Add("bells", "foghorn (in fog)", () => { s.SetWeather("fog"); s.Foghorn(); }, 6, 1, 1, 4.4, 5.6, it => s.SetWeather("clear"));
            Add("bells", "foghorn on a clear day (must stay silent)", () => s.Foghorn(), 0.8, after: it => it.Extra["silent"] = it.Voices.Count == 0);

            // ---- by chance
            Add("chance", "gulls", () => s.Gulls(), 3, 0.9, 0.9, 3, 6.05);
            Add("chance", "rope creak", () => s.Creak(), 2.5, 0.45, 0.45, 1.8, 5);
            Add("chance", "dog far off", () => s.Dog(), 3, 1, 1, 1.8, 3);
            Add("chance", "steam whistle far off", () => s.SteamWhistle(), 3, 0.7, 0.9);
            Add("chance", "crane at work", () => s.CraneWork(new Emitter { Kind = "crane", X = L.X, Z = L.Z - 8, Y = 6 }), 3, 0.6, 0.7, 2.5, 5.3);
            Add("chance", "cooper's mallet", () => s.CooperWork(new Emitter { Kind = "cooper", X = L.X, Z = L.Z - 6, Y = 1.2 }), 3, 0.35, 0.55);
            Add("chance", "pump", () => s.Pump(new Emitter { Kind = "pump", X = L.X, Z = L.Z - 5, Y = 1 }), 3, 0.6, 0.6, 2.8, 7.4);
            Add("chance", "carriage far off", () => s.CarriageFar(), 3, 0.8);
            Add("chance", "railway gate bell", () => s.GateBell(L.X, L.Z - 8), 3, 0.6, 0.6, 1.7, 3);
            Add("chance", "wheel over a rail joint", () => s.RailClack(L.X, L.Z - 6), 0.9, 1, 1, 0.1, 0.2);

            // ---- ships
            var paddle = new MovingShip { Id = "t1", Kind = "paddle steamer", X = L.X, Z = L.Z - 30, Speed = 3, Steam = true };
            var tug = new MovingShip { Id = "t2", Kind = "tug", X = L.X, Z = L.Z - 30, Speed = 3, Steam = true };
            var sail = new MovingShip { Id = "t3", Kind = "barge", X = L.X, Z = L.Z - 30, Speed = 1, Steam = false };
            Add("ships", "paddle steamer under way (loop)", () => { s.hornOkAt = s.now + 100; s.SetMovingShips(new[] { paddle }); }, 2.5, after: it => it.Approx = true);
            Add("ships", "tug under way (loop)", () => { s.hornOkAt = s.now + 100; s.SetMovingShips(new[] { tug }); }, 2.5, after: it => it.Approx = true);
            Add("ships", "steamer signals a bridge (long, short; keeper's bell)", () => s.ShipSignal(paddle, "bridge"), 6, 0.7, 0.8);
            Add("ships", "tug signals the lock", () => s.ShipSignal(tug, "lock"), 4, 0.7, 0.8);
            Add("ships", "sailing ship signals (shout, bell)", () => s.ShipSignal(sail, "bridge"), 4, 0.5, 0.7);
            Add("ships", "steamer's whistle as it passes", () => s.Whistle(paddle, "pass", 0, true), 3, 0.85, 0.85, 4.1, 6.6);
            Add("ships", "tug's toots", () => s.Whistle(tug, "pass", 0, true), 2.5, 0.75);
            Add("ships", "dray rolling (loop)", () => s.SetVehicles(new[] { new VehicleSound("dray", L.X, L.Z - 8, "go") }), 2, after: it => it.Approx = true);
            Add("ships", "handcart rolling (loop)", () => s.SetVehicles(new[] { new VehicleSound("handcart", L.X, L.Z - 5, "go") }), 2, after: it => it.Approx = true);

            // ---- loops at places (each kind once, at full level)
            foreach (var (kind, def) in Loops.Append(new KeyValuePair<string, LoopDef>("unseen cart", CartLoop)))
            {
                double d = Math.Min(def.Radius * 0.4, 6);
                Add("loops", $"loop: {kind}, {d:0.#} m ahead", () =>
                {
                    var lv = s.StartVoice(L.X, 1.5, L.Z - d, def);
                    if (lv == null) return;
                    lv.Spot.Level = lv.Spot.LevelT = 1;
                }, 2, def.Layers.Min(l => l.gain), def.Layers.Max(l => l.gain));
            }

            // ---- events
            Add("events", "peal (bells)", () => s.EventSound("bells", L.X, L.Z, 6), 3, 0.55);
            Add("events", "fire alarm", () => s.EventSound("alarm", L.X, L.Z, 6), 3, 0.55);
            Add("events", "procession handbell", () => s.EventSound("handbell", L.X, L.Z - 6, 6), 3, 0.55);
            Add("events", "music", () => s.EventSound("music", L.X, L.Z - 6, 8), 3.5, 0.5, after: it => it.Approx = true);
            Add("events", "murmur (ten people there)", () =>
            {
                s.SetCrowdAround(Enumerable.Range(0, 10).Select(i => new Vector2(L.X + i * 0.8f - 4, L.Z - 6)).ToArray());
                s.EventSound("murmur", L.X, L.Z - 6, 8);
            }, 3.5, 0.7, after: it => { it.Approx = true; it.Extra["peopleLevel"] = Math.Round(Chatter(10), 3); });
            Add("events", "stop fades an event's music out", () =>
            {
                var h = s.EventSound("music", L.X, L.Z - 6, 30);
                s.After(2.5, h.Stop);
            }, 4.5, after: it =>
            {
                it.Approx = true;
                it.Extra["placesLeft"] = s.placedCount;
            });
            foreach (string cue in Audio.EventCues.Made.Concat(Audio.EventCues.Recorded))
                Add("events", $"cue: {cue}", () =>
                {
                    var spot = s.NewSpot(L.X, 1.5, L.Z - 5, 3, 1.15, 75, 0.3, 14000, s.Bus("voices"), 100);
                    var item = cur!;
                    s.MadeAt(spot, (c, dest, t0) => Audio.EventCues.PlayCue(c, dest, new CueSpec(cue, 0, 1, 1), t0), "cue " + cue, 0.9, 0.5,
                        built: len => item.Extra["cueSeconds"] = Math.Round(len, 2));
                }, cue is "hymn" ? 4.5 : 2.4, cue is "cheer" or "laughter" or "applause" or "shout" or "cry" or "hymn" or "fiddle" or "drum" or "whistle" or "glass" or "clatter" or "crackle" or "horse" ? 0.9 : double.NaN);
            Add("events", "cues on a stage (a drum every second, 5 s)", () => s.EventCues(new[] { new CueSpec("drum", 1, 1, 1) }, L.X, L.Z - 5, 5), 6, after: it => it.Extra["hits"] = it.Voices.Count);

            // ---- the town's life, with the reach its browser caller gives it
            void P(string name, Vector3 where, PlacedOpts o, Make make, double listen, double s0 = double.NaN, double s1 = double.NaN)
                => Add("life", name, () => cur!.Extra["started"] = s.Placed(where, o, make, name), listen, o.Gain, o.Gain, s0, s1);
            P("leaves", Front(3, 0.1), new(1.5, 6, 8, 1.4, 0.1, Gain: 0.5), AliveSounds.Leaves(0.7, 1.5), 2.2, 1.8);
            P("wings, pigeons (8)", Front(8, 6), new(3, 30, 60, Occl: 0.3), AliveSounds.Wings(8), 2.6, 2.2);
            P("wings, sparrows (3)", Front(4, 0.5), new(1.5, 10, 18, Gain: 0.3), AliveSounds.Wings(3), 2.6, 2.2);
            P("sparrow chirp", Front(4, 0.3), new(1.5, 10, 18), AliveSounds.Chirp(), 1.4, 0.18, 1.1);
            P("jackdaw", Front(10, 12), new(3, 60, 120, Occl: 0.25), AliveSounds.Jackdaw(), 1.2, 0.3, 0.74);
            P("drip", Front(1.5, 0.05), new(0.8, 3, 5, 1.3, Gain: 0.7), AliveSounds.Drip(), 0.7, 0.15);
            P("gutter splash", Front(1.5, 0.05), new(0.8, 3, 5, 1.3, Gain: 0.8), AliveSounds.GutterSplash(0.8, 1.5), 2.2, 1.65);
            P("thunder near (0.6 km, recording with the made tear)", new Vector3(L.X, 105, L.Z - 150), new(400, 5000, 1e9, Occl: 0, Wet: 0.7, Must: true), AliveSounds.Thunder(0.6), 5);
            items[^1].GainMin = items[^1].GainMax = 1.25;
            P("thunder far (5 km, recording)", new Vector3(L.X, 200, L.Z - 300), new(400, 5000, 1e9, Occl: 0, Wet: 0.7, Must: true), AliveSounds.Thunder(5), 5);
            items[^1].GainMin = items[^1].GainMax = 0.55 / (1 + (5 - 3) / 6.0);
            Add("life", "thunder near, built (no recording)", () =>
            {
                var hold = AliveSounds.RecordedNear.ToArray();
                AliveSounds.RecordedNear.Clear();
                cur!.Extra["started"] = s.Placed(new Vector3(L.X, 105, L.Z - 150), new(400, 5000, 1e9, Occl: 0, Wet: 0.7, Must: true), AliveSounds.Thunder(0.6), "thunder built");
                AliveSounds.RecordedNear.AddRange(hold);
            }, 6, 1, 1, 2, 9.5);
            Add("life", "thunder far, built (no recording)", () =>
            {
                var hold = AliveSounds.RecordedFar.ToArray();
                AliveSounds.RecordedFar.Clear();
                cur!.Extra["started"] = s.Placed(new Vector3(L.X, 200, L.Z - 300), new(400, 5000, 1e9, Occl: 0, Wet: 0.7, Must: true), AliveSounds.Thunder(5), "thunder built");
                AliveSounds.RecordedFar.AddRange(hold);
            }, 6, 1, 1, 2, 16.5);
            P("cat's hiss", Front(2, 0.3), new(1, 5, 7), AliveSounds.Hiss(), 1.4, 0.9);
            P("buoy bell (2 strikes)", Front(30, 1), new(8, 250, 650, Occl: 0, Wet: 0.6), AliveSounds.BuoyBell(2), 4, 5.7, 8.6);
            P("bilge pump (2 strokes)", Front(6, 0.5), new(2, 25, 45), AliveSounds.Bilge(2, 1.2), 3.4, 3.2);
            P("owl", Front(20, 9), new(5, 120, 260, Occl: 0.5, Wet: 0.5), AliveSounds.Owl(), 6.5, 0.5, 6.35);
            P("horse's snort", Front(3, 1.5), new(1.5, 8, 12), AliveSounds.Snort(), 1.2, 0.7);
            P("storm: shutter (3 knocks)", Front(10, 3), new(4, 60, 110, Wet: 0.35), AliveSounds.ShutterBang(3), 2.2, 0.64, 1.5);
            P("storm: slate", Front(10, 1), new(4, 50, 90, Wet: 0.3), AliveSounds.SlateCrash(), 3, 1.6, 2.3);
            P("storm: shop sign", Front(6, 3.2), new(2.5, 30, 45, Wet: 0.25), AliveSounds.SignCreak(), 4, 1.1, 4.5);
            P("storm: gust", new Vector3(L.X, 3, L.Z - 40), new(30, 400, 1e9, Occl: 0, Wet: 0.5, Gain: 0.9, Must: true), AliveSounds.GustRoar(0.8, 3), 3.8, 3.2);
            P("storm: rolling cask", Front(8, 0.3), new(3, 40, 60, Wet: 0.2), AliveSounds.RollingCask(3), 4, 3.4);
            P("storm: wave on the quay", Front(12, 0.5), new(5, 70, 120, Wet: 0.35, Gain: 1.2), AliveSounds.WaveSlam(0.9), 3.4, 2.4);

            // ---- rooms
            Add("rooms", "tavern at 21:00, twelve people (talk and song)", () => { s.SetClock(21); s.SetInterior("tavern"); s.SetRoomPeople(12); s.Settle(); }, 3, after: it =>
            {
                it.Approx = true;
                it.Extra["roomBeds"] = s.Graph()["roomBeds"];
                it.Extra["street"] = new[] { s.streetGainT, s.streetLpT };
                s.SetClock(13);
            });
            Add("rooms", "cellar, twenty people (murmur)", () => { s.SetInterior("cellar"); s.SetRoomPeople(20); s.Settle(); }, 2.5, after: it => { it.Approx = true; it.Extra["roomBeds"] = s.Graph()["roomBeds"]; });
            Add("rooms", "church: the organ, without the hall's echo (for the next row)", () => { s.SetInterior("church"); s.hallVerb.Wet = 0; s.organVerb.Wet = 0; s.roomVerb.Wet = 0; s.Organ(true); }, 9, after: it => { it.Approx = true; SetVerb(s.roomVerb, 0.52, 0.22 * ConvolverGain(0.7)); });
            Add("rooms", "church: the organ", () => { s.SetInterior("church"); s.Organ(true); }, 9, after: it => { it.Approx = true; it.Extra["organOn"] = s.OrganOn; it.Extra["street"] = new[] { s.streetGainT, s.streetLpT }; });
            Add("rooms", "church: the altar bell", () => { s.SetInterior("church"); s.AltarBell(); }, 3, 1, 1, 1.3, 1.5);
        }

        /// <summary>A voice began: what it is, its gain, and the peak it should make in the recording.</summary>
        public void Started(Spot sp, V v)
        {
            if (cur == null) return;
            double envPeak = 1;
            double span = Math.Min(double.IsFinite(v.Len) ? v.Len : cur.Listen, wallEnd - s.now);
            // the stream's own peak over what is listened to, through its envelope
            double raw = 0;
            try
            {
                var pb = v.Stream.InstantiatePlayback();
                pb.Start(v.From);
                int frames = (int)(Math.Max(0.05, span) * s.mixRate), n = 0;
                envPeak = 0;
                while (n < frames)
                {
                    var a = pb.MixAudio((float)v.Pitch, Math.Min(4096, frames - n));
                    if (a.Length == 0) break;
                    for (int i = 0; i < a.Length; i++)
                    {
                        double e = v.Env?.At((double)(n + i) / s.mixRate) ?? 1;
                        envPeak = Math.Max(envPeak, e);
                        raw = Math.Max(raw, Math.Max(Math.Abs(a[i].X), Math.Abs(a[i].Y)) * e);
                    }
                    n += a.Length;
                }
                pb.Stop();
            }
            catch (Exception e)
            {
                cur.Extra["decode"] = e.Message;
            }
            raw *= v.StreamScale;
            double level = v.Level * sp.Level;
            double pan = sp.Flat ? 1 : sp.Pan * GodotCentre;
            double expected = Expect(sp, v, raw, level);
            watch.Add((cur, sp, v, raw, level));
            double cut = sp.Chan != null ? Math.Min(sp.Lp, sp.SrcLp) : 20500;
            if (cut < 9000 || sp.Hp) cur.Filtered = true;
            if (v.Env == null && (v.LevelT != v.Level || sp.LevelT != sp.Level)) cur.Approx = true;
            cur.Voices.Add(new Dictionary<string, object?>
            {
                ["what"] = v.What,
                ["made"] = v.RawPeak > 0,
                ["at_s"] = Math.Round(s.now - cur.W0, 3),
                ["gain"] = Math.Round(v.Gain * envPeak * (v.Stream is AudioStreamWav && v.RawPeak > 0 ? 0.95 / v.RawPeak : 1), 4),
                ["sourcePeak"] = Math.Round(raw * v.Gain, 4),
                ["chain"] = Math.Round(level * sp.Fog * pan, 5),
                ["distance_m"] = sp.Flat ? null : Math.Round(s.DistTo(sp.X, sp.Y, sp.Z), 1),
                ["lowpass_hz"] = Math.Round(cut),
                ["bus"] = sp.Out,
                ["rate"] = Math.Round(v.Pitch, 3),
                ["seconds"] = double.IsFinite(v.Len) ? Math.Round(v.Len, 3) : null,
                ["expectedPeak"] = Math.Round(expected, 5),
            });
        }

        /// <summary>The peak a voice should make in the recording: through the kind's bus (1), the street (0.9, not in a room) and the compressor's 0.9 dB.</summary>
        private double Expect(Spot sp, V v, double raw, double level)
        {
            bool room = sp.Out.StartsWith("Room") || sp.Out == "Organ";
            // Measure reports the louder channel. A source to one side has more than the centre's .7071 there.
            double d = s.DistTo(sp.X, sp.Y, sp.Z);
            double channel = d > 1e-6 ? Math.Sqrt(0.5 * (1 + Math.Min(1, Math.Abs(sp.X - s.listenerPos.X) / d))) : GodotCentre;
            double pan = sp.Flat ? 1 : sp.Pan * channel;
            return raw * v.Gain * level * sp.Fog * pan * (room ? 1 : 0.9) * Math.Pow(10, 0.9 / 20);
        }

        public void Tick()
        {
            callName = "none";
            if (done) return;
            A();
            PlaceCamera();
            if (at < 0)
            {
                // a moment for the load and the made beds, then record
                if (s.now < 1.5 || s.waterLoop == null) return;
                rec.SetRecordingActive(true);
                recStart = A();
                at = 0;
                next = s.now + 0.4;
                gap = true;
                return;
            }
            if (s.now < next) return;
            if (!gap)
            {
                // the row's time is up: quiet, a short gap, then the next
                cur!.T1 = A();
                // a level that was still rising when the voice began (a loop) counts as where it got to
                foreach (var w in watch)
                {
                    double e = Expect(w.sp, w.v, w.raw, Math.Max(w.level0, w.v.Level * w.sp.Level));
                    w.it.Expected = Math.Max(w.it.Expected, e);
                    w.it.ExpectedSum += e;
                }
                watch.Clear();
                cur.W1 = s.now;
                cur.After?.Invoke(cur);
                cur = null;
                s.Silence(keep);
                gap = true;
                next = s.now + 0.3;
                at++;
                return;
            }
            gap = false;
            if (at < items.Count)
            {
                cur = items[at];
                if (at % 20 == 0) GD.Print($"sound test: row {at + 1}/{items.Count}, {cur.Name}");
                cur.T0 = A();
                cur.T1 = cur.T0 + cur.Listen;
                wallEnd = next = s.now + cur.Listen;
                cur.W0 = s.now;
                try
                {
                    // what the call itself costs on the main thread (without the test's own decoding)
                    s.testMs = 0;
                    long c0 = System.Diagnostics.Stopwatch.GetTimestamp();
                    cur.Do();
                    cur.CallMs = System.Diagnostics.Stopwatch.GetElapsedTime(c0).TotalMilliseconds - s.testMs;
                    // Calibration constructs its own nodes/buffers; gameplay triggers are part of this frame's budget.
                    if (cur.Group != "measure") { callCost += cur.CallMs; callName = cur.Name; }
                }
                catch (Exception e)
                {
                    cur.Extra["error"] = e.Message;
                }
                return;
            }
            Layers();
        }

        public void PlaceCamera()
        {
            var cam = Main.I.Cam;
            if (cam != null) cam.GlobalTransform = new Transform3D(Basis.Identity, pos);
        }

        // ---- the layers: three hours, rain, the great storm
        private int layer = -1;
        private readonly List<Dictionary<string, object?>> layerRows = new();
        private (string name, double t0, double t1) layerNow;
        private static readonly (string name, double hour, string weather, double rain, double tempest)[] LayerSet =
        {
            ("03:00, clear", 3, "clear", 0, 0), ("13:00, clear", 13, "clear", 0, 0), ("20:00, clear", 20, "clear", 0, 0),
            ("13:00, rain", 13, "rain", 1, 0), ("13:00, the great storm", 13, "storm", 1, 1),
        };

        private void Layers()
        {
            if (layer >= 0)
            {
                var g = (Dictionary<string, object>)s.Graph()["gains"]!;
                var set = LayerSet[layer];
                double night = 1 - s.Dayness, T = set.tempest;
                // what the browser's slowTick gives at the quay edge (no houses between, by open water)
                var want = new Dictionary<string, double>
                {
                    ["water"] = 0.5 * (1 + 0.4 * night) * (1 + 2.2 * T),
                    ["wind"] = (0.3 + 0.15 * night) * (0.65 + 0.35 * 1) * (1 + 1.6 * T),
                    ["rainRoofs"] = 0.4 * set.rain * (1 + T * ((1 + 1.4) * 0.25 - 1)),
                    ["rainCobbles"] = 1.1 * set.rain * (1 + 0.7 * T),
                    ["murmur"] = 0,
                };
                layerRows.Add(new Dictionary<string, object?>
                {
                    ["name"] = layerNow.name,
                    ["t0"] = layerNow.t0 - recStart,
                    ["t1"] = A() - recStart,
                    ["gains"] = g,
                    ["browserGains"] = want,
                    ["active"] = s.Graph()["active"],
                    ["howl"] = Math.Round(s.howlGain, 4),
                    ["storm"] = s.stormBeds == null ? null : new Dictionary<string, object> { ["gale"] = Math.Round(s.stormBeds.Value.gale.Level, 3), ["rain"] = Math.Round(s.stormBeds.Value.rain.Level, 3), ["downpour"] = Math.Round(s.downpourSpot?.Level ?? 0, 3) },
                    ["mismatch"] = want.Where(k => Math.Abs(Convert.ToDouble(g[k.Key]) - k.Value) > 0.002).Select(k => $"{k.Key}: {g[k.Key]} here, {k.Value:0.###} in the browser").ToArray(),
                });
            }
            layer++;
            if (layer >= LayerSet.Length || skipLayers)
            {
                Finish();
                return;
            }
            var l = LayerSet[layer];
            if (layer == 0)
            {
                // the beds and the loops back on, the reverb too; over the water's edge, where the water bed is full
                s.Auto = true;
                AudioServer.SetBusMute(s.busIndex["Reverb"], false);
                var q = Emitters.NearestQuay(L.X, L.Z);
                if (double.IsFinite(q.d)) pos = new Vector3((float)q.x, 1.7f, (float)q.z);
                Main.I.Cam.GlobalTransform = new Transform3D(Basis.Identity, pos);
                long updateAt = System.Diagnostics.Stopwatch.GetTimestamp();
                double updateTest = s.testMs;
                s.Update(Main.I.Cam);
                callCost += System.Diagnostics.Stopwatch.GetElapsedTime(updateAt).TotalMilliseconds - (s.testMs - updateTest);
            }
            long stateAt = System.Diagnostics.Stopwatch.GetTimestamp();
            double stateTest = s.testMs;
            s.SetClock(l.hour);
            s.SetWeather(l.weather);
            s.SetRain(l.rain);
            s.SetTempest(l.tempest, l.tempest > 0 ? 1.5 : 0, 0);
            callCost += System.Diagnostics.Stopwatch.GetElapsedTime(stateAt).TotalMilliseconds - (s.testMs - stateTest);
            callName = l.name;
            s.Settle();
            layerNow = (l.name, A(), 0);
            next = s.now + (l.tempest > 0 ? 6 : 4.5);
            gap = true;
        }

        // ---- the recording, read back

        private short[] pcm = Array.Empty<short>();
        private int rate;

        private (double peak, double rms, double peakL, double peakR, double seconds) Measure(double t0, double t1, double floor = 0.0008)
        {
            int a = Math.Clamp((int)((t0 - recStart) * rate), 0, pcm.Length / 2), b = Math.Clamp((int)((t1 - recStart) * rate), 0, pcm.Length / 2);
            double pl = 0, pr = 0, sum = 0;
            int first = -1, last = -1;
            for (int i = a; i < b; i++)
            {
                double l = pcm[i * 2] / 32768.0, r = pcm[i * 2 + 1] / 32768.0;
                pl = Math.Max(pl, Math.Abs(l));
                pr = Math.Max(pr, Math.Abs(r));
                sum += (l * l + r * r) / 2;
                if (Math.Abs(l) > floor || Math.Abs(r) > floor)
                {
                    if (first < 0) first = i;
                    last = i;
                }
            }
            return (Math.Max(pl, pr), b > a ? Math.Sqrt(sum / (b - a)) : 0, pl, pr, first < 0 ? 0 : (double)(last - first) / rate);
        }

        private static double D(double g) => g <= 1e-6 ? -120 : Math.Round(20 * Math.Log10(g), 1);

        private void Finish()
        {
            done = true;
            rec.SetRecordingActive(false);
            var wav = rec.GetRecording();
            var rows = new List<Dictionary<string, object?>>();
            var problems = new List<string>();
            var wiring = s.WiringChecks();
            foreach (var check in wiring) if (!check.Value) problems.Add("wiring: " + check.Key);
            var measured = new Dictionary<string, object?>();
            if (wav == null) problems.Add("no recording came back from the recorder");
            else
            {
                wav.SaveToWav(Path.Combine(dir, "soundtest.wav"));
                var data = wav.Data;
                rate = wav.MixRate;
                pcm = new short[data.Length / 2];
                Buffer.BlockCopy(data, 0, pcm, 0, pcm.Length * 2);
                if (!wav.Stereo) problems.Add("the recording is mono");
            }
            double makeup = Math.Pow(10, 0.9 / 20);
            foreach (var it in items)
            {
                var m = Measure(it.T0, it.T1 + 0.25);
                var row = new Dictionary<string, object?>
                {
                    ["group"] = it.Group,
                    ["name"] = it.Name,
                    ["played"] = it.Voices.Count > 0 || it.Group == "measure",
                    ["heard"] = m.peak > 0.0008,
                    ["peak_db"] = D(m.peak),
                    ["rms_db"] = D(m.rms),
                    ["seconds"] = Math.Round(m.seconds, 2),
                    ["listened_s"] = Math.Round(it.T1 - it.T0, 2),
                };
                var miss = new List<string>();
                if (it.Group == "measure" && it.Name.StartsWith("onset"))
                {
                    // the peak of each 10 ms from the first sample heard, against the loudest
                    int a = Math.Clamp((int)((it.T0 - recStart) * rate), 0, pcm.Length / 2), b = Math.Clamp((int)((it.T1 - recStart) * rate), 0, pcm.Length / 2);
                    int first = -1;
                    for (int i = a; i < b && first < 0; i++) if (Math.Abs(pcm[i * 2]) > 60) first = i;
                    var bins = new double[18];
                    for (int k = 0; k < bins.Length && first >= 0; k++)
                        for (int i = first + (int)(k * 0.01 * rate) - 20; i < first + (int)((k + 1) * 0.01 * rate) - 20 && i < b; i++) if (i >= 0) bins[k] = Math.Max(bins[k], Math.Abs(pcm[i * 2]) / 32768.0);
                    double top = bins.Max();
                    measured[it.Name + ": each 10 ms against the loudest, dB"] = bins.Select(x => D(x / Math.Max(top, 1e-9))).ToArray();
                }
                else if (it.Group == "measure" && it.Name.StartsWith("thud"))
                {
                    row["peak_minus_expected_db"] = Math.Round(D(m.peak) - D(it.Expected), 2);
                    measured[it.Name + ": peak against the recording's own, dB"] = row["peak_minus_expected_db"];
                }
                else if (it.Group == "measure")
                {
                    if (it.Name.StartsWith("tone"))
                    {
                        // the tone through Effects, Street (0.9) and the compressor's 0.9 dB
                        double unit = ToneLevel * 0.9 * makeup * (it.Name.Contains("ear") ? 1 : PanMakeup) * (it.Name.Contains("40 m") ? Inverse(40, 4, 1.2) : 1);
                        row["left"] = Math.Round(m.peakL / unit, 4);
                        row["right"] = Math.Round(m.peakR / unit, 4);
                        measured[it.Name] = new[] { row["left"], row["right"] };
                    }
                    else
                    {
                        // noise in, reverb out: the level while it plays, and how fast it dies after
                        var on = Measure(it.T0 + 1.0, it.T0 + 1.9);
                        double gain = on.rms / (noiseRms * makeup);
                        double t5 = -1, t25 = -1;
                        double refRms = on.rms;
                        for (double t = it.T0 + 2.0; t < it.T1; t += 0.05)
                        {
                            double r = Measure(t, t + 0.05).rms / refRms;
                            if (t5 < 0 && r < 0.562) t5 = t;
                            if (t25 < 0 && r < 0.0562) { t25 = t; break; }
                        }
                        row["gain"] = Math.Round(gain, 4);
                        row["t60_s"] = t5 > 0 && t25 > 0 ? Math.Round((t25 - t5) * 3, 2) : null;
                        measured[it.Name] = new[] { row["gain"], row["t60_s"] };
                        if (it.Extra.TryGetValue("browser", out var bw) && bw is double[] want)
                        {
                            if (Math.Abs(D(gain) - D(want[0])) > 1.5) miss.Add($"reverb level: {gain:0.####} here, {want[0]:0.####} in the browser");
                            double t60 = row["t60_s"] is double q ? q : 0;
                            if (Math.Abs(t60 - want[1]) > Math.Max(0.35, want[1] * 0.25)) miss.Add($"reverb length: {t60:0.##} s here, {want[1]:0.##} s in the browser");
                        }
                    }
                }
                else
                {
                    row["voices"] = it.Voices.Count;
                    row["what"] = it.Voices.Select(v => (string)v["what"]!).Distinct().ToArray();
                    if (it.Voices.Count > 0)
                    {
                        var first = it.Voices[0];
                        row["gain"] = it.Voices.Max(v => Convert.ToDouble(v["gain"]));
                        row["planned_s"] = it.Voices.Max(v => v["seconds"] == null ? 0 : Convert.ToDouble(v["seconds"]));
                        row["expected_peak_db"] = D(it.Expected);
                        row["distance_m"] = first["distance_m"];
                        row["bus"] = first["bus"];
                        row["lowpass_hz"] = first["lowpass_hz"];
                        double diff = D(m.peak) - D(it.Expected);
                        row["peak_minus_expected_db"] = Math.Round(diff, 1);
                        string note = it.Filtered ? "filtered" : it.Approx ? "level still rising or several at once" : it.Voices.Count > 1 ? "several at once" : "";
                        if (note != "") row["note"] = note;
                        // a single unfiltered sound must come out at the level the chain says, within 2.5 dB (a made sound
                        // lands within 0.3; a recording's sharp peaks move a dB or two with the resampling and the lowpass)
                        // (and Godot brings a sound at a place in over its first few milliseconds: "onset 2 m ahead", 3 dB off
                        // a recording that begins with its sharpest sample)
                        if (note == "" && (diff > 2.5 || diff < -3.5)) miss.Add($"level: {D(m.peak)} dB in the recording, {D(it.Expected)} dB by the chain");
                        // several at once, or filtered: never more than all of them together, and a little
                        double over = D(m.peak) - D(it.ExpectedSum);
                        if (note != "" && !it.Name.Contains("organ") && over > 4) miss.Add($"level: {over:0.0} dB over what the chain gives for all its voices together");
                        row["call_ms"] = Math.Round(it.CallMs, 3);
                        if (!double.IsNaN(it.GainMin))
                        {
                            row["browser_gain"] = it.GainMin == it.GainMax ? it.GainMin : new[] { Math.Round(it.GainMin, 4), Math.Round(it.GainMax, 4) };
                            double gmax = Convert.ToDouble(row["gain"]);
                            if (gmax < it.GainMin * 0.98 || gmax > it.GainMax * 1.02) miss.Add($"gain: {gmax:0.###} here, {it.GainMin:0.###} to {it.GainMax:0.###} in the browser");
                        }
                        if (!double.IsNaN(it.SecMin))
                        {
                            row["browser_seconds"] = new[] { it.SecMin, it.SecMax };
                            double planned = Convert.ToDouble(row["planned_s"]);
                            // (a made sound is trimmed where it has died away: it may be shorter than the browser's nodes run, never longer)
                            bool made = it.Voices.Any(v => (bool)v["made"]!);
                            // (a placed sound may ring 1.5 s past its nominal length, as the browser's does before it is cut)
                            if (planned > it.SecMax + (it.Group == "life" ? 1.5 : 0.15) || (!made && planned < it.SecMin - 0.15) || (made && planned < it.SecMin * 0.4)) miss.Add($"length: {planned:0.##} s here, {it.SecMin:0.##} to {it.SecMax:0.##} s in the browser");
                        }
                    }
                    bool mustBeSilent = it.Name.Contains("must stay silent") || it.Name.Contains("no tower bells");
                    if (!mustBeSilent && it.Voices.Count == 0) miss.Add("nothing played");
                    if (!mustBeSilent && it.Voices.Count > 0 && m.peak <= 0.0008 && it.Expected > 0.002) miss.Add("played but not in the recording");
                    if (it.Name.Contains("must stay silent") && it.Voices.Count > 0) miss.Add("it played");
                }
                foreach (var (k, val) in it.Extra) row[k] = val;
                if (miss.Count > 0)
                {
                    row["mismatch"] = miss.ToArray();
                    problems.Add($"{it.Name}: {string.Join("; ", miss)}");
                }
                row["detail"] = it.Voices.Take(6).ToArray();
                rows.Add(row);
            }
            foreach (var l in layerRows)
            {
                var m = Measure(recStart + Convert.ToDouble(l["t0"]) + 1.0, recStart + Convert.ToDouble(l["t1"]));
                l["peak_db"] = D(m.peak);
                l["rms_db"] = D(m.rms);
                l["t0"] = Math.Round(Convert.ToDouble(l["t0"]), 2);
                l["t1"] = Math.Round(Convert.ToDouble(l["t1"]), 2);
                foreach (string x in (string[])l["mismatch"]!) problems.Add($"layers {l["name"]}: {x}");
            }
            var graph = s.Graph();
            var cost = (Dictionary<string, object>)graph["cost"]!;
            frameCosts.Sort();
            if (frameCosts.Count > 0)
            {
                cost["p95Ms"] = Math.Round(frameCosts[(int)((frameCosts.Count - 1) * 0.95)], 4);
                cost["p99Ms"] = Math.Round(frameCosts[(int)((frameCosts.Count - 1) * 0.99)], 4);
                cost["framesOverBudget"] = frameCosts.Count(x => x > 0.3);
                cost["overBudget"] = overBudget;
            }
            double maxAt = Convert.ToDouble(cost["maxAt_s"]);
            cost["maxDuring"] = items.FirstOrDefault(i => maxAt >= i.W0 - 0.05 && maxAt <= i.W1 + 0.35)?.Name ?? "the layers, or before the first row";
            cost["startingSoundsMs"] = ProfNames.Select((n, i) => $"{n}: {s.prof[i]:0.0}").ToArray();
            cost["dearestCalls"] = items.OrderByDescending(i => i.CallMs).Take(6).Select(i => $"{i.Name}: {i.CallMs:0.00} ms").ToArray();
            // the organ with the hall's echo against the organ alone: the browser's convolver gives about +1.7 dB (twice 0.62 x 0.551 of it, added in power)
            var dry = items.Find(i => i.Name.Contains("without the hall"));
            var wetRow = items.Find(i => i.Name == "church: the organ");
            if (dry != null && wetRow != null && dry.T1 > 0)
                measured["organ with the hall's echo, dB over the organ alone (browser: about 1.7)"] = Math.Round(D(Measure(wetRow.T0 + 4, wetRow.T1).rms) - D(Measure(dry.T0 + 4, dry.T1).rms), 1);
            if (frameCosts.Any(x => x > 0.3)) problems.Add($"{cost["framesOverBudget"]} sound frames exceeded 0.3 ms (worst {cost["maxMs"]} ms; see cost.overBudget)");
            var outp = new Dictionary<string, object?>
            {
                ["when"] = DateTime.Now.ToString("yyyy-MM-dd HH:mm"),
                ["mixRate"] = s.mixRate,
                ["recording"] = new Dictionary<string, object?> { ["file"] = "soundtest.wav", ["seconds"] = Math.Round(pcm.Length / 2.0 / Math.Max(1, rate), 1), ["rate"] = rate },
                ["loaded"] = new Dictionary<string, object?> { ["recordings"] = s.buf.Count, ["steps"] = s.StepSamples, ["failed"] = s.failed.ToArray(), ["decodedLevels"] = s.decodeLevels },
                ["constants"] = new Dictionary<string, object?> { ["panMakeup"] = PanMakeup, ["godotCentre"] = GodotCentre, ["panStrength"] = PanStrength },
                ["measured"] = measured,
                ["cost"] = cost,
                ["mixer"] = graph["mixer"],
                ["wiring"] = wiring,
                ["rows"] = rows.Count,
                ["played"] = rows.Count(r => (bool)r["played"]!),
                ["problems"] = problems,
                ["sounds"] = rows,
                ["layers"] = layerRows,
            };
            File.WriteAllText(Path.Combine(dir, "soundtest.json"), JsonSerializer.Serialize(outp, new JsonSerializerOptions { WriteIndented = true, NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowNamedFloatingPointLiterals }));
            GD.Print($"sound test done: {rows.Count} rows, {problems.Count} problems, cost {cost["meanMs"]} ms a frame (max {cost["maxMs"]}); {Path.Combine(dir, "soundtest.json")}");
            foreach (string p in problems.Take(60)) GD.Print("  problem: " + p);
            s.GetTree().Quit(problems.Count == 0 ? 0 : 1);
        }
    }
}

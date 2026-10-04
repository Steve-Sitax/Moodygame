using System;
using System.Collections.Generic;
using static Scheldemist.Audio.Wa;

namespace Scheldemist.Audio;

/// <summary>A made sound: builds its graph into `dest` from `t0` and returns its length in seconds (the browser's Make).</summary>
public delegate double Make(Wa c, Node dest, double t0);

/// <summary>A note: semitones above the singer's home note, and its length in beats (audio/ballad.ts).</summary>
public readonly record struct Note(double Semitones, double Beats);

/// <summary>
/// A voice that sings (audio/ballad.ts), made in code: a glottal sawtooth and a little breath through two vowel
/// formants; the pitch follows a tune, one note to a syllable, with a slow vibrato and a short dip between syllables.
/// </summary>
public static class Ballad
{
    /// <summary>Sung vowels (first and second formant, Hz, a man's): ah, oh, ee, eh, oo, aw.</summary>
    private static readonly double[][] Vowels = { new[] { 730.0, 1090 }, new[] { 570.0, 840 }, new[] { 300.0, 2250 }, new[] { 530.0, 1840 }, new[] { 320.0, 900 }, new[] { 620.0, 1000 } };

    /// <summary>Sing one line into `dest`. Returns the time it ends.</summary>
    public static double SingPhrase(Wa c, Node dest, double f0, double formant, IReadOnlyList<Note> notes, double beat, double t0)
    {
        var osc = c.Osc("sawtooth");
        var breath = c.Noise();
        var bGain = c.Gain(0.18);
        var mix = c.Gain(0.8);
        osc.Connect(mix);
        breath.Connect(bGain).Connect(mix);
        // a slow vibrato, deeper on the long notes (a singer's wobble)
        var lfo = c.Osc("sine", 5.3);
        var depth = c.Gain(0);
        lfo.Connect(depth).Connect(osc.Frequency);
        var f1 = c.Biquad("bandpass", 350, 5);
        var f2 = c.Biquad("bandpass", 350, 8);
        var env = c.Gain(0);
        mix.Connect(f1).Connect(env);
        mix.Connect(f2).Connect(env);
        env.Connect(dest);
        double t = t0;
        for (int i = 0; i < notes.Count; i++)
        {
            double len = notes[i].Beats * beat;
            double f = f0 * Math.Pow(2, notes[i].Semitones / 12);
            // semi can be below the home note (the day's shift), so keep the index positive
            int n = Vowels.Length;
            var v = Vowels[(int)((((i * 7 + Math.Round(notes[i].Semitones)) % n) + n) % n)];
            // slide into the note a little, as untrained voices do
            osc.Frequency.SetTargetAtTime(f, t, i == 0 ? 0.005 : 0.03);
            f1.Frequency.SetTargetAtTime(v[0] * formant, t, 0.025);
            f2.Frequency.SetTargetAtTime(v[1] * formant, t, 0.025);
            depth.G.SetTargetAtTime(len > 0.5 ? f * 0.014 : f * 0.004, t + Math.Min(0.2, len * 0.4), 0.08);
            // the consonant: a short dip, then the vowel held
            env.G.SetValueAtTime(i == 0 ? 0 : 0.25, t);
            env.G.LinearRampToValueAtTime(1, t + 0.05);
            env.G.SetValueAtTime(0.9, t + len * 0.8);
            env.G.LinearRampToValueAtTime(i == notes.Count - 1 ? 0 : 0.35, t + len * 0.98);
            t += len;
        }
        osc.Start(t0);
        breath.Start(t0);
        lfo.Start(t0);
        osc.Stop(t + 0.1);
        breath.Stop(t + 0.1);
        lfo.Stop(t + 0.1);
        return t;
    }
}

/// <summary>
/// The street cries and the sounds of the street trades (audio/cries.ts), made in code. A cry is a short sung call
/// (Soundscape.Sing): each trade its own tune. The words stay unsung: the voice sings vowels.
/// </summary>
public static class Cries
{
    public sealed record Cry(Note[] Notes, double Beat, string Words);

    private static Note[] N(params double[] v)
    {
        var o = new Note[v.Length / 2];
        for (int i = 0; i < o.Length; i++) o[i] = new Note(v[i * 2], v[i * 2 + 1]);
        return o;
    }

    public static readonly Dictionary<string, Cry> All = new()
    {
        ["milk_woman"] = new(N(0, 1, 4, 1, 2, 2), 0.26, "Milk! Fresh milk!"),
        ["baker_boy"] = new(N(0, 0.5, 0, 0.5, 5, 1, 3, 1.5), 0.22, "Bread! Rolls, white rolls!"),
        ["mussel_seller"] = new(N(7, 1, 7, 0.5, 5, 0.5, 4, 1, 2, 0.5, 0, 0.5, 0, 2), 0.24, "Fresh mussels, big and small!"),
        ["ragman"] = new(N(0, 1, 0, 0.5, 3, 0.5, 5, 1.5, 3, 0.5, 0, 2), 0.24, "Any old iron? Rags and bones!"),
        ["grinder"] = new(N(5, 1, 4, 0.5, 2, 0.5, 0, 2), 0.26, "Knives and scissors to grind!"),
        ["coalman"] = new(N(0, 1.5, -3, 2), 0.3, "Coal! Good coal!"),
        ["broom_seller"] = new(N(4, 1, 4, 1, 2, 0.5, 0, 2), 0.25, "Brooms! Birch brooms!"),
        ["sweep"] = new(N(7, 1, 7, 2, 4, 1, 4, 2), 0.22, "Sweep! Chimney sweep!"),
    };

    /// <summary>One work sound into `dest` for about `seconds`: "grind", "rattle", "clink", "scrub". Returns when the last node stops.</summary>
    public static double WorkSound(Wa c, Node dest, string kind, double seconds, double t0)
    {
        double dur = Math.Clamp(seconds, 0.3, 12);
        var src = c.Noise();
        var env = c.Gain(0);
        double end = t0 + dur + 0.3;
        if (kind == "grind")
        {
            // steel on a turning stone: a hiss through a narrow band, with a whine that rises and falls as the blade
            // is drawn across, and the treadle's rhythm in the level
            var bp = c.Biquad("bandpass", 3200, 3);
            var whine = c.Osc("triangle");
            whine.Frequency.SetValueAtTime(2400, t0);
            var wg = c.Gain(0.08);
            src.Connect(bp).Connect(env);
            whine.Connect(wg).Connect(env);
            for (double t = t0; t < t0 + dur; t += 0.8)
            {
                env.G.SetTargetAtTime(0.9, t, 0.05);
                env.G.SetTargetAtTime(0.35, t + 0.45, 0.08);
                whine.Frequency.SetTargetAtTime(2200 + Rnd() * 900, t, 0.2);
                bp.Frequency.SetTargetAtTime(2600 + Rnd() * 1400, t, 0.2);
            }
            env.G.SetTargetAtTime(0, t0 + dur, 0.05);
            whine.Start(t0);
            whine.Stop(t0 + dur + 0.3);
        }
        else if (kind == "rattle")
        {
            // a wooden rattle: quick dry clicks, a burst
            var hp = c.Biquad("bandpass", 1800, 1.5);
            src.Connect(hp).Connect(env);
            for (double t = t0; t < t0 + dur; t += 0.045 + Rnd() * 0.02)
            {
                env.G.SetValueAtTime(0.9, t);
                env.G.SetTargetAtTime(0, t + 0.004, 0.008);
            }
        }
        else if (kind == "clink")
        {
            // two copper cans knocking: a couple of hollow pings
            var o = c.Osc("sine");
            var og = c.Gain(0);
            o.Connect(og).Connect(dest);
            double t = t0;
            for (int k = 0; k < 3 && t < t0 + dur; k++, t += 0.35 + Rnd() * 0.4)
            {
                o.Frequency.SetValueAtTime(900 + Rnd() * 300, t);
                og.G.SetValueAtTime(0.35, t);
                og.G.SetTargetAtTime(0, t + 0.01, 0.12);
            }
            o.Start(t0);
            o.Stop(t0 + dur + 0.4);
            src.Connect(env);
            env.G.SetValueAtTime(0, t0);
            end = t0 + dur + 0.4;
        }
        else
        {
            // a stiff brush on wet stone: a rasp back and forth
            var bp = c.Biquad("bandpass", 1400, 0.8);
            src.Connect(bp).Connect(env);
            for (double t = t0; t < t0 + dur; t += 0.5)
            {
                env.G.SetTargetAtTime(0.6, t, 0.06);
                env.G.SetTargetAtTime(0.05, t + 0.3, 0.05);
            }
            env.G.SetTargetAtTime(0, t0 + dur, 0.05);
        }
        env.Connect(dest);
        src.Start(t0);
        src.Stop(t0 + dur + 0.3);
        return end;
    }
}

/// <summary>A sound cue of an event as the director composed it (audio/eventcues.ts): what, how often, how high, how loud.</summary>
public sealed record CueSpec(string Source, double EverySeconds, double Pitch, double Level);

/// <summary>
/// The sound cues of an event (audio/eventcues.ts): the voices (a cheer, laughter, a shout, a child's cry, a hymn),
/// a fiddle, a drum, a whistle, glass, wood, fire, all made in code; the rest plays a slice of a recording already
/// in the game (the bells, the chain, the anvil, the pump, the hooves, the dog). No words: the voices are vowels.
/// </summary>
public static class EventCues
{
    private sealed class VoiceParts
    {
        public OscNode Osc = null!;
        public SrcNode Breath = null!;
        public BiquadNode F1 = null!, F2 = null!;
        public GainNode Env = null!;
        public void Start(double t) { Osc.Start(t); Breath.Start(t); }
        public void Stop(double t) { Osc.Stop(t); Breath.Stop(t); }
    }

    /// <summary>A voice: a glottal sawtooth and breath through two formants, into `Env` (gain 0 to start).</summary>
    private static VoiceParts Voice(Wa c, double f0, double[] vowel, double formant = 1)
    {
        var osc = c.Osc("sawtooth", f0);
        var breath = c.Noise();
        var bGain = c.Gain(0.25);
        var mix = c.Gain(0.8);
        osc.Connect(mix);
        breath.Connect(bGain).Connect(mix);
        var f1 = c.Biquad("bandpass", vowel[0] * formant, 6);
        var f2 = c.Biquad("bandpass", vowel[1] * formant, 9);
        var env = c.Gain(0);
        mix.Connect(f1).Connect(env);
        mix.Connect(f2).Connect(env);
        return new VoiceParts { Osc = osc, Breath = breath, F1 = f1, F2 = f2, Env = env };
    }

    /// <summary>A burst of the noise through a filter with its own envelope.</summary>
    private static void Burst(Wa c, Node dest, string type, double freq, double q, double t, double attack, double decay, double level, double hold = 0)
    {
        var src = c.Noise();
        var f = c.Biquad(type, freq, q);
        var g = c.Gain();
        g.G.SetValueAtTime(0, t);
        g.G.LinearRampToValueAtTime(level, t + attack);
        g.G.SetValueAtTime(level, t + attack + hold);
        g.G.SetTargetAtTime(0, t + attack + hold, decay);
        src.Connect(f).Connect(g).Connect(dest);
        src.Start(t);
        src.Stop(t + attack + hold + decay * 6 + 0.05);
    }

    /// <summary>A struck tone: a sine that decays.</summary>
    private static void Ping(Wa c, Node dest, double freq, double t, double decay, double level, string type = "sine")
    {
        var o = c.Osc(type, freq);
        var g = c.Gain();
        g.G.SetValueAtTime(level, t);
        g.G.SetTargetAtTime(0, t + 0.005, decay);
        o.Connect(g).Connect(dest);
        o.Start(t);
        o.Stop(t + decay * 6 + 0.05);
    }

    /// <summary>A slice of a recording, faded in and out: the soundscape plays it. Returns its seconds, 0 when it is not loaded.</summary>
    private static double Slice(Wa c, string name, double t, double from, double secs, double rate, double level, double fade = 0.15)
    {
        double dur = c.SampleSeconds(name);
        if (dur < 0) return 0;
        double len = Math.Min(secs, Math.Max(0, dur - from)) / rate;
        c.Extras.Add(new Extra(name, t, from, secs, rate, level, fade));
        return len;
    }

    private static readonly double[] AH = { 730, 1090 }, OH = { 570, 840 }, EH = { 530, 1840 };
    /// <summary>The cues made in code; the others are slices of recordings.</summary>
    public static readonly string[] Made = { "cheer", "laughter", "applause", "shout", "cry", "hymn", "fiddle", "drum", "whistle", "glass", "clatter", "crackle", "horse" };
    public static readonly string[] Recorded = { "murmur", "handbell", "bell", "ship_bell", "chain", "anvil", "pump", "steam_whistle", "hooves", "wheels", "dog" };

    /// <summary>Make one hit of a cue into `dest` at `t0`. Returns about how many seconds it lasts.</summary>
    public static double PlayCue(Wa c, Node dest, CueSpec cue, double t0)
    {
        double pitch = Math.Clamp(cue.Pitch, 0.6, 1.5);
        double level = Math.Clamp(cue.Level, 0.15, 1);
        switch (cue.Source)
        {
            case "cheer":
                {
                    // eight to twelve voices on "ah", each its own pitch, rising a fourth then falling, not together
                    int n = 8 + (int)Math.Floor(Rand(0, 5));
                    double dur = Rand(1.4, 2.2);
                    for (int i = 0; i < n; i++)
                    {
                        bool man = Rnd() < 0.65;
                        double f0 = (man ? Rand(105, 160) : Rand(190, 260)) * pitch;
                        var v = Voice(c, f0, AH, man ? 1 : 1.15);
                        double t = t0 + Rand(0, 0.35);
                        v.Osc.Frequency.SetValueAtTime(f0, t);
                        v.Osc.Frequency.ExponentialRampToValueAtTime(f0 * Rand(1.25, 1.5), t + dur * 0.35);
                        v.Osc.Frequency.ExponentialRampToValueAtTime(f0 * Rand(0.95, 1.15), t + dur);
                        v.Env.G.SetValueAtTime(0, t);
                        v.Env.G.LinearRampToValueAtTime(level * 0.16, t + 0.08);
                        v.Env.G.SetValueAtTime(level * 0.16, t + dur * 0.6);
                        v.Env.G.LinearRampToValueAtTime(0, t + dur);
                        v.Env.Connect(dest);
                        v.Start(t);
                        v.Stop(t + dur + 0.05);
                    }
                    return dur + 0.4;
                }
            case "laughter":
                {
                    // two or three voices "ha ha ha": pulses that fall in pitch as the breath goes
                    int n = 2 + (int)Math.Floor(Rand(0, 2));
                    double longest = 0;
                    for (int k = 0; k < n; k++)
                    {
                        bool man = Rnd() < 0.6;
                        double f0 = (man ? Rand(120, 175) : Rand(200, 280)) * pitch;
                        var v = Voice(c, f0, k % 2 == 1 ? EH : AH, man ? 1 : 1.15);
                        int pulses = 4 + (int)Math.Floor(Rand(0, 4));
                        double t = t0 + Rand(0, 0.3);
                        for (int i = 0; i < pulses; i++)
                        {
                            double gap = Rand(0.15, 0.22);
                            v.Osc.Frequency.SetValueAtTime(f0 * (1 - i * 0.025) * Rand(0.97, 1.03), t);
                            v.Env.G.SetValueAtTime(0, t);
                            v.Env.G.LinearRampToValueAtTime(level * 0.2, t + 0.03);
                            v.Env.G.LinearRampToValueAtTime(0, t + gap * 0.7);
                            t += gap;
                        }
                        v.Env.Connect(dest);
                        v.Start(t0);
                        v.Stop(t + 0.1);
                        longest = Math.Max(longest, t - t0);
                    }
                    return longest + 0.3;
                }
            case "applause":
                {
                    // many hands: the noise through a band, its level a random crackle, swelling then thinning
                    double dur = Rand(2, 3.5);
                    var src = c.Noise();
                    var f = c.Biquad("bandpass", 2200, 0.7);
                    var g = c.Gain();
                    int steps = (int)Math.Floor(dur * 90);
                    var curve = new float[steps];
                    for (int i = 0; i < steps; i++)
                    {
                        double k = (double)i / steps;
                        double swell = k < 0.15 ? k / 0.15 : k > 0.7 ? (1 - k) / 0.3 : 1;
                        curve[i] = (float)((Rnd() < 0.35 ? Rand(0.4, 1) : Rand(0, 0.12)) * swell * level * 0.45);
                    }
                    g.G.SetValueCurveAtTime(curve, t0, dur);
                    src.Connect(f).Connect(g).Connect(dest);
                    src.Start(t0);
                    src.Stop(t0 + dur + 0.05);
                    return dur;
                }
            case "shout":
                {
                    // one man, loud, two or three syllables, the pitch falling: a call across a square
                    double f0 = Rand(115, 165) * pitch;
                    var v = Voice(c, f0, AH);
                    int syl = 2 + (int)Math.Floor(Rand(0, 2));
                    double t = t0;
                    var vowels = new[] { AH, OH, EH };
                    for (int i = 0; i < syl; i++)
                    {
                        bool last = i == syl - 1;
                        double len = last ? Rand(0.35, 0.55) : Rand(0.16, 0.24);
                        var vw = vowels[i % vowels.Length];
                        v.F1.Frequency.SetTargetAtTime(vw[0], t, 0.02);
                        v.F2.Frequency.SetTargetAtTime(vw[1], t, 0.02);
                        v.Osc.Frequency.SetValueAtTime(f0 * (last ? 1.2 : 1.05), t);
                        v.Osc.Frequency.ExponentialRampToValueAtTime(f0 * (last ? 0.8 : 0.98), t + len);
                        v.Env.G.SetValueAtTime(0, t);
                        v.Env.G.LinearRampToValueAtTime(level * 0.5, t + 0.03);
                        v.Env.G.SetValueAtTime(level * 0.45, t + len * 0.7);
                        v.Env.G.LinearRampToValueAtTime(0, t + len);
                        t += len + 0.04;
                    }
                    v.Env.Connect(dest);
                    v.Start(t0);
                    v.Stop(t + 0.1);
                    return t - t0 + 0.3;
                }
            case "cry":
                {
                    // a child's wail: a high voice with a wide, slow wobble, up then down, twice, a gulp between
                    double f0 = Rand(330, 420) * pitch;
                    var v = Voice(c, f0, EH, 1.35);
                    var lfo = c.Osc("sine", 5.5);
                    var depth = c.Gain(f0 * 0.04);
                    lfo.Connect(depth).Connect(v.Osc.Frequency);
                    double t = t0;
                    for (int i = 0; i < 2; i++)
                    {
                        double len = Rand(0.9, 1.4);
                        v.Osc.Frequency.SetValueAtTime(f0, t);
                        v.Osc.Frequency.ExponentialRampToValueAtTime(f0 * 1.3, t + len * 0.4);
                        v.Osc.Frequency.ExponentialRampToValueAtTime(f0 * 0.85, t + len);
                        v.Env.G.SetValueAtTime(0, t);
                        v.Env.G.LinearRampToValueAtTime(level * 0.22, t + 0.12);
                        v.Env.G.SetValueAtTime(level * 0.2, t + len * 0.75);
                        v.Env.G.LinearRampToValueAtTime(0, t + len);
                        t += len + Rand(0.3, 0.5);
                    }
                    v.Env.Connect(dest);
                    v.Start(t0);
                    lfo.Start(t0);
                    v.Stop(t + 0.1);
                    lfo.Stop(t + 0.1);
                    return t - t0 + 0.3;
                }
            case "hymn":
                {
                    // four voices in slow chords, sung (the ballad voice), a bar of five notes; nobody in tune together
                    double beat = 0.8 / pitch;
                    var tune = new[] { new Note(0, 2), new Note(4, 2), new Note(7, 2), new Note(5, 2), new Note(4, 3) };
                    var parts = new (double f0, double semis, double formant)[] { (98, 0, 1), (131, 4, 1), (220, 0, 1.15), (262, 4, 1.15) };
                    double end = t0;
                    foreach (var p in parts)
                    {
                        var g = c.Gain(level * 0.55);
                        g.Connect(dest);
                        var notes = new Note[tune.Length];
                        for (int i = 0; i < tune.Length; i++) notes[i] = new Note(tune[i].Semitones + p.semis, tune[i].Beats);
                        end = Math.Max(end, Ballad.SingPhrase(c, g, p.f0 * pitch * Rand(0.985, 1.015), p.formant, notes, beat, t0 + Rand(0, 0.12)));
                    }
                    return end - t0 + 0.5;
                }
            case "murmur":
                {
                    double d = c.SampleSeconds("murmur");
                    return d < 0 ? 0 : Slice(c, "murmur", t0, Rand(0, Math.Max(0, d - 6)), 5, pitch, level * 0.5, 0.8);
                }
            case "fiddle":
                {
                    // a fiddle: a sawtooth through the body's resonance, a slow wobble, a quick phrase of a dance
                    int[] scale = { 0, 2, 4, 5, 7, 9, 11, 12, 14 };
                    int n = 7 + (int)Math.Floor(Rand(0, 5));
                    double beat = 0.19 / pitch;
                    double home = 392 * pitch; // G above middle C
                    var o = c.Osc("sawtooth");
                    var lfo = c.Osc("sine", 6);
                    var depth = c.Gain(home * 0.008);
                    lfo.Connect(depth).Connect(o.Frequency);
                    var body = c.Biquad("peaking", 2400, 1.2);
                    body.GainDb.Value = 8;
                    var lp = c.Biquad("lowpass", 5200);
                    var env = c.Gain(0);
                    o.Connect(body).Connect(lp).Connect(env).Connect(dest);
                    double t = t0;
                    int step = (int)Math.Floor(Rand(0, 3));
                    int[] moves = { -2, -1, -1, 1, 1, 2, 3 };
                    for (int i = 0; i < n; i++)
                    {
                        step = Math.Clamp(step + Pick(moves), 0, scale.Length - 1);
                        double f = home * Math.Pow(2, scale[step] / 12.0);
                        double len = i == n - 1 ? beat * 2.5 : Rnd() < 0.25 ? beat * 2 : beat;
                        o.Frequency.SetTargetAtTime(f, t, 0.012);
                        env.G.SetValueAtTime(level * 0.08, t);
                        env.G.LinearRampToValueAtTime(level * 0.16, t + 0.03);
                        env.G.SetValueAtTime(level * 0.14, t + len * 0.85);
                        env.G.LinearRampToValueAtTime(i == n - 1 ? 0 : level * 0.06, t + len);
                        t += len;
                    }
                    o.Start(t0);
                    lfo.Start(t0);
                    o.Stop(t + 0.1);
                    lfo.Stop(t + 0.1);
                    return t - t0 + 0.3;
                }
            case "drum":
                {
                    // a side drum: a low skin thump with a snap of noise, a roll of four
                    foreach (double d in new[] { 0, 0.42, 0.84, 1.05 })
                    {
                        double t = t0 + d / pitch;
                        Ping(c, dest, 160 * pitch, t, 0.09, level * 0.7);
                        Burst(c, dest, "bandpass", 1800, 0.8, t, 0.004, 0.05, level * 0.5);
                    }
                    return 1.4 / pitch + 0.3;
                }
            case "whistle":
                {
                    // a man's whistle: two notes, up and held, with a little lip wobble
                    var o = c.Osc("sine");
                    double f = 1700 * pitch;
                    var g = c.Gain();
                    g.G.SetValueAtTime(0, t0);
                    o.Frequency.SetValueAtTime(f, t0);
                    o.Frequency.LinearRampToValueAtTime(f * 1.28, t0 + 0.18);
                    o.Frequency.SetValueAtTime(f * 1.28, t0 + 0.35);
                    o.Frequency.LinearRampToValueAtTime(f * 1.22, t0 + 0.6);
                    g.G.LinearRampToValueAtTime(level * 0.16, t0 + 0.03);
                    g.G.SetValueAtTime(level * 0.16, t0 + 0.5);
                    g.G.LinearRampToValueAtTime(0, t0 + 0.62);
                    o.Connect(g).Connect(dest);
                    o.Start(t0);
                    o.Stop(t0 + 0.7);
                    return 0.9;
                }
            case "glass":
                {
                    // a bottle breaking: a sharp crack, then the shards ring, a few late tinkles on the stones
                    Burst(c, dest, "highpass", 2800, 0.7, t0, 0.003, 0.06, level * 0.8);
                    foreach (double f in new[] { 3100.0, 4650, 6200, 7900 }) Ping(c, dest, f * pitch * Rand(0.97, 1.03), t0 + 0.01, Rand(0.25, 0.6), level * 0.12, "triangle");
                    for (int i = 0; i < 4; i++) Ping(c, dest, Rand(5000, 9000) * pitch, t0 + Rand(0.12, 0.6), Rand(0.05, 0.14), level * 0.07, "triangle");
                    return 1.2;
                }
            case "clatter":
                {
                    // wood on wood: chests set down, a stall knocked; a few hollow thuds with a dry knock in each
                    int n = 3 + (int)Math.Floor(Rand(0, 3));
                    double t = t0;
                    for (int i = 0; i < n; i++)
                    {
                        Ping(c, dest, Rand(140, 220) * pitch, t, 0.07, level * 0.5);
                        Burst(c, dest, "bandpass", 900 * pitch, 2, t, 0.003, 0.03, level * 0.6);
                        t += Rand(0.07, 0.3);
                    }
                    return t - t0 + 0.4;
                }
            case "crackle":
                {
                    // a fire: a low roar and the wood snapping, a burst of two or three seconds
                    double dur = Rand(2, 3.2);
                    var src = c.Noise();
                    var lp = c.Biquad("lowpass", 260);
                    var roar = c.Gain();
                    roar.G.SetValueAtTime(0, t0);
                    roar.G.LinearRampToValueAtTime(level * 0.5, t0 + 0.4);
                    roar.G.SetValueAtTime(level * 0.5, t0 + dur - 0.5);
                    roar.G.LinearRampToValueAtTime(0, t0 + dur);
                    src.Connect(lp).Connect(roar).Connect(dest);
                    src.Start(t0);
                    src.Stop(t0 + dur + 0.05);
                    for (double t = t0 + Rand(0, 0.2); t < t0 + dur; t += Rand(0.05, 0.3)) Burst(c, dest, "bandpass", Rand(1200, 3500), 1.5, t, 0.002, Rand(0.01, 0.04), level * Rand(0.2, 0.6));
                    return dur;
                }
            case "horse":
                {
                    // a horse: a neigh (a rough voice with a fast shake, up then down) and a snort after it
                    double f0 = 330 * pitch;
                    var v = Voice(c, f0, new[] { 900.0, 1900 }, 1.3);
                    var lfo = c.Osc("sine", 13);
                    var depth = c.Gain(f0 * 0.09);
                    lfo.Connect(depth).Connect(v.Osc.Frequency);
                    double len = Rand(0.9, 1.3);
                    v.Osc.Frequency.SetValueAtTime(f0 * 0.8, t0);
                    v.Osc.Frequency.ExponentialRampToValueAtTime(f0 * 1.5, t0 + len * 0.3);
                    v.Osc.Frequency.ExponentialRampToValueAtTime(f0 * 0.7, t0 + len);
                    v.Env.G.SetValueAtTime(0, t0);
                    v.Env.G.LinearRampToValueAtTime(level * 0.3, t0 + 0.08);
                    v.Env.G.SetValueAtTime(level * 0.28, t0 + len * 0.7);
                    v.Env.G.LinearRampToValueAtTime(0, t0 + len);
                    v.Env.Connect(dest);
                    v.Start(t0);
                    lfo.Start(t0);
                    v.Stop(t0 + len + 0.1);
                    lfo.Stop(t0 + len + 0.1);
                    Burst(c, dest, "lowpass", 700, 0.5, t0 + len + Rand(0.3, 0.6), 0.02, 0.12, level * 0.5, 0.1);
                    return len + 1.2;
                }
            // ---- the recordings (audio/samples.ts)
            case "handbell": return Slice(c, "handbell", t0, 0, 2.4, pitch * Rand(0.97, 1.03), level * 0.55, 0.01);
            case "bell": return Slice(c, "hourStroke", t0, 0, 4, 0.82 * pitch, level * 0.6, 0.01);
            case "ship_bell": return Slice(c, "shipBell", t0, 0, 3, pitch, level * 0.5, 0.01);
            case "chain": return Slice(c, "chain", t0, 0, 3, pitch, level * 0.5, 0.05);
            case "anvil": return Slice(c, "anvil", t0, Rand(0, 8), 2.2, pitch, level * 0.5, 0.05);
            case "pump": return Slice(c, "pump", t0, 0, 4, pitch, level * 0.5, 0.1);
            case "steam_whistle": return Slice(c, "steamWhistleFar", t0, 0, 5, pitch, level * 0.6, 0.2);
            case "hooves": return Slice(c, "hooves", t0, Rand(0, 12), 4, pitch, level * 0.5, 0.6);
            case "wheels": return Slice(c, "wheels", t0, Rand(0, 12), 4, pitch, level * 0.45, 0.6);
            case "dog":
                {
                    var span = Pick(Samples.DogSpans);
                    return Slice(c, "dogFar", t0, span[0], span[1] - span[0], pitch, level * 0.6, 0.05);
                }
            default: return 0;
        }
    }
}

/// <summary>
/// The cathedral's organ and the altar bell (audio/organ.ts), made in code. The organ is a soft chord bed: for each
/// note of a chord a sine, a soft triangle an octave up and a quiet quint, through a gentle lowpass; the chords walk
/// slowly through a plain progression in D. The altar bell is three quick strikes of a small bell.
/// </summary>
public static class OrganSynth
{
    private static double NoteHz(int m) => 440 * Math.Pow(2, (m - 69) / 12.0);
    // D major and friends, voiced low (MIDI numbers): I, vi, IV, V, I, IV, ii, V
    private static readonly int[][] Chords =
    {
        new[] { 50, 57, 62, 66 }, new[] { 47, 54, 59, 62 }, new[] { 43, 55, 59, 62 }, new[] { 45, 52, 57, 61 },
        new[] { 50, 57, 62, 66 }, new[] { 43, 50, 59, 67 }, new[] { 52, 55, 59, 64 }, new[] { 45, 49, 57, 64 },
    };
    /// <summary>A chord every 4.2 s; the eight chords come round in 33.6 s.</summary>
    public const double ChordSeconds = 4.2;
    public const double CycleSeconds = ChordSeconds * 8;
    /// <summary>The organ's level in the browser (bus gain 0.16 x level).</summary>
    public const double BusGain = 0.16;

    /// <summary>
    /// The chord bed as a loop: two rounds are built and the second is kept (the first begins from silence, the
    /// second from the last chord, as every later round does), with a short crossfade over the seam.
    /// </summary>
    public static float[] RenderLoop(int rate)
    {
        var c = new Wa(rate);
        var lp = c.Biquad("lowpass", 1600, 0.4);
        lp.Connect(c.Destination);
        var voices = new List<(List<(OscNode o, double mult)> oscs, GainNode gain)>();
        for (int i = 0; i < 4; i++)
        {
            var gain = c.Gain(0);
            gain.Connect(lp);
            var oscs = new List<(OscNode, double)>();
            void Mk(string type, double mult, double g, double detune)
            {
                var o = c.Osc(type);
                o.Detune = detune;
                var og = c.Gain(g);
                o.Connect(og).Connect(gain);
                o.Start(0);
                oscs.Add((o, mult));
            }
            Mk("sine", 1, 0.55, -3 + i);
            Mk("triangle", 2, 0.16, 2 - i);
            Mk("sine", 3, 0.05, 0);
            voices.Add((oscs, gain));
        }
        const double fade = 0.05;
        for (int i = 0; i < 17; i++)
        {
            var ch = Chords[i % Chords.Length];
            double t = i * ChordSeconds;
            for (int k = 0; k < voices.Count; k++)
            {
                double f = NoteHz(ch[k]);
                foreach (var (o, mult) in voices[k].oscs) o.Frequency.SetTargetAtTime(f * mult, t, 0.08);
                // a breath between chords, the bass a little louder
                voices[k].gain.G.CancelScheduledValues(t);
                voices[k].gain.G.SetTargetAtTime(0.15, t, 0.05);
                voices[k].gain.G.SetTargetAtTime(k == 0 ? 0.34 : 0.24, t + 0.12, 0.35);
            }
        }
        var all = c.Render(CycleSeconds * 2 + fade);
        int n = (int)Math.Round(CycleSeconds * rate), nf = (int)(fade * rate);
        var loop = new float[n];
        Array.Copy(all, n, loop, 0, n);
        for (int i = 0; i < nf && 2 * n + i < all.Length; i++)
        {
            float k = (float)i / nf;
            loop[i] = loop[i] * k + all[2 * n + i] * (1 - k);
        }
        return loop;
    }

    /// <summary>The altar bell at the elevation: three quick strikes.</summary>
    public static double Bell(Wa c, Node dest, double t0)
    {
        for (int s = 0; s < 3; s++)
        {
            double t = t0 + s * 0.22;
            foreach (var (mult, g) in new[] { (1.0, 0.14), (2.76, 0.07), (5.4, 0.04) })
            {
                var o = c.Osc("sine", 1320 * mult);
                var og = c.Gain();
                og.G.SetValueAtTime(0, t);
                og.G.LinearRampToValueAtTime(g, t + 0.004);
                og.G.ExponentialRampToValueAtTime(0.0005, t + 0.9);
                o.Connect(og).Connect(dest);
                o.Start(t);
                o.Stop(t + 1);
            }
        }
        return 0.44 + 1;
    }
}

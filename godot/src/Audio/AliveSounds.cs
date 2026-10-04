using System;
using System.Collections.Generic;
using static Scheldemist.Audio.Wa;

namespace Scheldemist.Audio;

/// <summary>
/// The small sounds of the town's life (audio/aliveSounds.ts), all made in code: dry leaves, pigeons' wings, sparrows,
/// a jackdaw, a drip off the eaves, thunder, a cat's hiss, the bell on a buoy, a bilge pump, a tawny owl, and the
/// great storm's. Each maker builds its sound into `dest` from `t0` and returns its length in seconds;
/// Soundscape.Placed puts it at a place with its own reach (the caller picks the reach).
/// </summary>
public static class AliveSounds
{
    private static GainNode Env(Wa c, Node dest, double t, double a, double peak, double d, double curve = 0.3)
    {
        var g = c.Gain();
        g.G.SetValueAtTime(0, t);
        g.G.LinearRampToValueAtTime(peak, t + a);
        g.G.SetTargetAtTime(0, t + a, d * curve);
        g.Connect(dest);
        return g;
    }

    private static void NoiseBurst(Wa c, Node dest, double t, string type, double f, double q, double a, double level, double d)
    {
        var src = c.Noise();
        var flt = c.Biquad(type, f, q);
        src.Connect(flt).Connect(Env(c, dest, t, a, level, d));
        src.Start(t, Rnd() * 2);
        src.Stop(t + a + d * 1.6 + 0.05);
    }

    private static OscNode Tone(Wa c, Node dest, double t, string type, double f0, double f1, double dur, double a, double level)
    {
        var o = c.Osc(type);
        o.Frequency.SetValueAtTime(f0, t);
        o.Frequency.ExponentialRampToValueAtTime(Math.Max(20, f1), t + dur);
        var g = c.Gain();
        g.G.SetValueAtTime(0, t);
        g.G.LinearRampToValueAtTime(level, t + a);
        g.G.LinearRampToValueAtTime(0, t + dur);
        o.Connect(g).Connect(dest);
        o.Start(t);
        o.Stop(t + dur + 0.02);
        return o;
    }

    /// <summary>Dry leaves and a scrap of paper scraping over the cobbles in a gust: `k` 0..1 how many.</summary>
    public static Make Leaves(double k, double secs) => (c, dest, t0) =>
    {
        int n = (int)Math.Round(6 + k * 26);
        for (int i = 0; i < n; i++)
        {
            double t = t0 + Rnd() * secs;
            NoiseBurst(c, dest, t, "bandpass", Rand(2500, 6500), Rand(0.8, 2.5), 0.004, Rand(0.05, 0.16) * (0.5 + k), Rand(0.02, 0.09));
        }
        // the hiss of the lot under it
        NoiseBurst(c, dest, t0, "highpass", 3200, 0.5, secs * 0.4, 0.035 * k, secs * 0.5);
        return secs + 0.3;
    };

    /// <summary>A flock going up: wing claps, fast at first, then the whirr. `n` birds.</summary>
    public static Make Wings(double n) => (c, dest, t0) =>
    {
        int claps = (int)Math.Round(8 + n * 1.5);
        for (int i = 0; i < claps; i++)
        {
            double t = t0 + Math.Pow(Rnd(), 1.6) * 1.4;
            NoiseBurst(c, dest, t, "bandpass", Rand(700, 1600), Rand(1.2, 2.5), 0.003, Rand(0.12, 0.3), Rand(0.02, 0.05));
        }
        NoiseBurst(c, dest, t0 + 0.2, "bandpass", 1100, 0.8, 0.3, 0.06 * Math.Min(1, n / 12), 1.2);
        return 2.2;
    };

    /// <summary>A sparrow: two to five short chirps, high and a little rough.</summary>
    public static Make Chirp() => (c, dest, t0) =>
    {
        int n = 2 + (int)Math.Floor(Rnd() * 4);
        double t = t0;
        double b = Rand(3800, 4800);
        for (int i = 0; i < n; i++)
        {
            double d = Rand(0.04, 0.08);
            Tone(c, dest, t, "sine", b * Rand(1.05, 1.25), b * Rand(0.75, 0.9), d, 0.005, Rand(0.05, 0.09));
            Tone(c, dest, t, "triangle", b * 0.5 * Rand(1, 1.1), b * 0.45, d, 0.005, 0.02);
            t += d + Rand(0.05, 0.14);
        }
        return t - t0;
    };

    /// <summary>A jackdaw's call: a short hard "tchak", once or twice.</summary>
    public static Make Jackdaw() => (c, dest, t0) =>
    {
        int n = Rnd() < 0.5 ? 1 : 2;
        double t = t0;
        for (int i = 0; i < n; i++)
        {
            double f = Rand(1100, 1400);
            var o = c.Osc("sawtooth");
            o.Frequency.SetValueAtTime(f * 1.25, t);
            o.Frequency.ExponentialRampToValueAtTime(f * 0.8, t + 0.09);
            var bp = c.Biquad("bandpass", 1900, 2.5);
            o.Connect(bp).Connect(Env(c, dest, t, 0.006, 0.12, 0.07));
            o.Start(t);
            o.Stop(t + 0.18);
            NoiseBurst(c, dest, t, "bandpass", 2600, 1.5, 0.003, 0.05, 0.05);
            t += Rand(0.2, 0.32);
        }
        return t - t0 + 0.1;
    };

    /// <summary>A drop off the eaves into a puddle or on the stone.</summary>
    public static Make Drip() => (c, dest, t0) =>
    {
        double f = Rand(900, 2200);
        Tone(c, dest, t0, "sine", f * 1.6, f * 0.7, 0.06, 0.002, Rand(0.05, 0.1));
        NoiseBurst(c, dest, t0, "bandpass", Rand(3000, 5000), 2, 0.001, 0.025, 0.015);
        return 0.15;
    };

    /// <summary>Water off a broken gutter landing on the stones, `len` seconds of it; `strong` 0..1 how hard it pours.</summary>
    public static Make GutterSplash(double strong, double len) => (c, dest, t0) =>
    {
        int n = Math.Max(2, (int)Math.Round(len * (6 + 34 * strong)));
        for (int i = 0; i < n; i++)
        {
            double t = t0 + Rnd() * len;
            NoiseBurst(c, dest, t, "bandpass", Rand(1400, 4200), 1.2, 0.002, Rand(0.02, 0.045) * (0.6 + 0.4 * strong), Rand(0.02, 0.05));
            if (Rnd() < 0.25) Tone(c, dest, t, "sine", Rand(700, 1500) * 1.5, Rand(500, 900), 0.05, 0.002, Rand(0.015, 0.035));
        }
        // under it, when it pours, a low soft rush
        if (strong > 0.4) NoiseBurst(c, dest, t0, "lowpass", 900, 0.5, len * 0.3, 0.025 * strong, len * 0.5);
        return len + 0.15;
    };

    /// <summary>The recorded thunderclaps by name, set by the soundscape once loaded (audio/samples.ts THUNDER_NEAR, THUNDER_FAR).</summary>
    public static readonly List<string> RecordedNear = new(), RecordedFar = new();

    /// <summary>
    /// Thunder `km` off. With the recordings in: a real clap by distance; near (under 1.3 km) the air tears first (a
    /// dense ripping crack, made here) and the boom comes on it. Without them: built as it happens (ThunderSynth),
    /// when the sound is rendered, off the main thread. The caller waits km / 343 s.
    /// </summary>
    public static Make Thunder(double km) => (c, dest, t0) =>
    {
        var rec = km < 1.3 ? RecordedNear : RecordedFar;
        if (rec.Count > 0) return PlayRecorded(c, dest, t0, km, rec[(int)Math.Floor(Rnd() * rec.Count) % rec.Count]);
        double d0 = Math.Max(120, km * 1000);
        var src = c.Src(() => ThunderSynth.Build(km, 22050), 22050);
        src.Connect(dest);
        src.Start(t0);
        return (d0 < 1000 ? 9 : 16) + 0.5;
    };

    private static double PlayRecorded(Wa c, Node dest, double t0, double km, string name)
    {
        bool near = km < 1.3;
        double rate = near ? Rand(1.0, 1.08) : km > 3 ? Rand(0.82, 0.93) : Rand(0.93, 1.0);
        double lowpass = near ? 9000 : 3200 / (1 + km / 2.5);
        double gain = near ? 1.25 : km > 3 ? 0.55 / (1 + (km - 3) / 6) : 0.85;
        double lead = 0;
        if (near)
        {
            // the tear: noise through a band, roughened fast, 0.2-0.45 s, then the boom
            double len = Rand(0.2, 0.45) * (1.3 - km / 1.3 * 0.5);
            var n = c.Noise();
            var bp = c.Biquad("bandpass", Rand(1800, 3200), 0.6);
            var ng = c.Gain();
            int steps = (int)Math.Floor(len * 90);
            ng.G.SetValueAtTime(0, t0);
            for (int i = 0; i < steps; i++)
            {
                double t = t0 + 0.003 + (double)i / steps * len;
                ng.G.SetValueAtTime(Rand(0.25, 1) * 0.9 * Math.Pow(1 - (double)i / steps, 1.4), t);
            }
            ng.G.SetTargetAtTime(0, t0 + len, 0.03);
            n.Connect(bp).Connect(ng).Connect(dest);
            n.Start(t0, Rnd());
            n.Stop(t0 + len + 0.3);
            // and the blast of it, deep
            var bl = c.Noise(false);
            var blp = c.Biquad("lowpass", 220);
            var bg = c.Gain();
            bg.G.SetValueAtTime(0, t0 + len * 0.6);
            bg.G.LinearRampToValueAtTime(1.6, t0 + len * 0.6 + 0.02);
            bg.G.SetTargetAtTime(0, t0 + len * 0.6 + 0.02, 0.35);
            bl.Connect(blp).Connect(bg).Connect(dest);
            bl.Start(t0 + len * 0.6, Rnd());
            bl.Stop(t0 + len * 0.6 + 2);
            lead = len * 0.5;
        }
        double secs = Math.Max(0, c.SampleSeconds(name));
        c.Extras.Add(new Extra(name, t0 + lead, 0, secs, rate, gain, 0, lowpass));
        return lead + secs / rate + 0.3;
    }

    /// <summary>A cat's hiss (a cat you came too close to in the dark).</summary>
    public static Make Hiss() => (c, dest, t0) =>
    {
        NoiseBurst(c, dest, t0, "highpass", 2600, 0.7, 0.03, 0.12, 0.45);
        return 0.9;
    };

    /// <summary>The bell on a buoy: the clapper strikes as the buoy rolls, once or a few times. Inharmonic partials.</summary>
    public static Make BuoyBell(int strikes) => (c, dest, t0) =>
    {
        double t = t0;
        for (int s = 0; s < strikes; s++)
        {
            double lvl = Rand(0.5, 1) * 0.16;
            const double f = 520;
            foreach (var (m, a, d) in new[] { (0.5, 0.5, 5.0), (1, 1, 3.5), (1.19, 0.5, 2.5), (1.5, 0.35, 2), (2.0, 0.3, 1.5), (2.74, 0.2, 1), (3.9, 0.1, 0.6) })
            {
                var o = c.Osc("sine", f * m * Rand(0.998, 1.002));
                var g = c.Gain();
                g.G.SetValueAtTime(0, t);
                g.G.LinearRampToValueAtTime(lvl * a, t + 0.004);
                g.G.SetTargetAtTime(0, t + 0.004, d * 0.3);
                o.Connect(g).Connect(dest);
                o.Start(t);
                o.Stop(t + d * 1.6);
            }
            t += Rand(0.7, 1.8);
        }
        return t - t0 + 5;
    };

    /// <summary>A ship's bilge pump: the handle's clank and a gush of water into the river, `strokes` times.</summary>
    public static Make Bilge(int strokes, double period) => (c, dest, t0) =>
    {
        for (int s = 0; s < strokes; s++)
        {
            double t = t0 + s * period;
            // the iron clank of the brake (the handle) at the top of the stroke
            Tone(c, dest, t, "square", Rand(300, 360), 220, 0.05, 0.002, 0.04);
            NoiseBurst(c, dest, t, "bandpass", 1800, 3, 0.002, 0.06, 0.04);
            // wood creak on the way down
            Tone(c, dest, t + period * 0.35, "sawtooth", 140, 110, 0.18, 0.05, 0.015);
            // the water: a gush onto the water below
            NoiseBurst(c, dest, t + period * 0.45, "bandpass", Rand(600, 900), 0.8, 0.05, 0.12, period * 0.35);
            NoiseBurst(c, dest, t + period * 0.5, "highpass", 2500, 0.6, 0.05, 0.03, period * 0.3);
        }
        return strokes * period + 0.8;
    };

    /// <summary>A tawny owl: the male's long hoot, a pause, then the wavering "hu-hu-hoooo"; or the female's "ke-wick".</summary>
    public static Make Owl() => (c, dest, t0) =>
    {
        if (Rnd() < 0.3)
        {
            // ke-wick
            Tone(c, dest, t0, "sine", 1500, 1100, 0.12, 0.01, 0.06);
            Tone(c, dest, t0 + 0.13, "sine", 1700, 1250, 0.22, 0.01, 0.05);
            return 0.5;
        }
        double f = Rand(390, 430);
        void Hoot(double t, double dur, double lvl, double wob)
        {
            var o = c.Osc("sine");
            o.Frequency.SetValueAtTime(f * 0.97, t);
            o.Frequency.LinearRampToValueAtTime(f, t + 0.08);
            o.Frequency.LinearRampToValueAtTime(f * 0.93, t + dur);
            var lfo = c.Osc("sine", 11);
            var lg = c.Gain(f * wob);
            lfo.Connect(lg).Connect(o.Frequency);
            var g = c.Gain();
            g.G.SetValueAtTime(0, t);
            g.G.LinearRampToValueAtTime(lvl, t + 0.06);
            g.G.SetValueAtTime(lvl, t + dur - 0.1);
            g.G.LinearRampToValueAtTime(0, t + dur);
            var h = c.Osc("sine", f * 2);
            var hg = c.Gain(0.08);
            o.Connect(g).Connect(dest);
            h.Connect(hg).Connect(g);
            o.Start(t);
            lfo.Start(t);
            h.Start(t);
            o.Stop(t + dur + 0.02);
            lfo.Stop(t + dur + 0.02);
            h.Stop(t + dur + 0.02);
        }
        Hoot(t0, 0.75, 0.09, 0.004);
        double t1 = t0 + 0.75 + Rand(2.5, 4);
        Hoot(t1, 0.12, 0.06, 0.004);
        Hoot(t1 + 0.2, 0.12, 0.06, 0.004);
        Hoot(t1 + 0.42, 1.1, 0.08, 0.02);
        return t1 + 1.6 - t0;
    };

    /// <summary>A horse blowing out through its nose (a cold morning).</summary>
    public static Make Snort() => (c, dest, t0) =>
    {
        NoiseBurst(c, dest, t0, "bandpass", Rand(500, 800), 1.2, 0.02, 0.08, 0.25);
        NoiseBurst(c, dest, t0 + 0.05, "lowpass", 300, 1, 0.01, 0.05, 0.2);
        return 0.7;
    };

    // ------------------------------------------------------------------ the great storm (world/alive/gale.ts)

    /// <summary>A shutter or a loose door slammed by the wind against its frame: one to four hard wooden knocks.</summary>
    public static Make ShutterBang(int knocks) => (c, dest, t0) =>
    {
        double t = t0;
        for (int i = 0; i < knocks; i++)
        {
            double k = i == 0 ? 1 : Rand(0.35, 0.8);
            // the slam: a dull thud of the board and the rattle of the frame
            NoiseBurst(c, dest, t, "lowpass", Rand(500, 900), 0.8, 0.002, 0.5 * k, 0.09);
            NoiseBurst(c, dest, t, "bandpass", Rand(1400, 2600), 1.5, 0.001, 0.22 * k, 0.05);
            Tone(c, dest, t, "triangle", Rand(140, 210), Rand(90, 120), 0.12, 0.002, 0.18 * k);
            t += Rand(0.12, 0.55);
        }
        return t - t0 + 0.4;
    };

    /// <summary>A slate off a roof: a scrape down the tiles, then it breaks on the stones in pieces.</summary>
    public static Make SlateCrash() => (c, dest, t0) =>
    {
        double slide = Rand(0.25, 0.7);
        NoiseBurst(c, dest, t0, "bandpass", Rand(2200, 3400), 2.5, slide * 0.6, 0.05, slide * 0.4);
        double t = t0 + slide + Rand(0.35, 0.6); // (the fall from the eaves)
        NoiseBurst(c, dest, t, "highpass", 2500, 0.7, 0.001, 0.5, 0.12);
        Tone(c, dest, t, "square", Rand(1800, 2600), Rand(1200, 1600), 0.05, 0.001, 0.05);
        int bits = 5 + (int)Math.Floor(Rnd() * 7);
        for (int i = 0; i < bits; i++)
        {
            double tt = t + 0.03 + Math.Pow(Rnd(), 1.5) * 0.6;
            NoiseBurst(c, dest, tt, "bandpass", Rand(3000, 7000), Rand(2, 5), 0.001, Rand(0.05, 0.16), Rand(0.015, 0.04));
            if (Rnd() < 0.4) Tone(c, dest, tt, "sine", Rand(2500, 4800), Rand(2000, 3500), 0.03, 0.001, 0.03);
        }
        return t - t0 + 1;
    };

    /// <summary>A shop sign swinging on its iron bracket: the hinge's squeal as it goes, and back.</summary>
    public static Make SignCreak() => (c, dest, t0) =>
    {
        int swings = 2 + (int)Math.Floor(Rnd() * 3);
        double t = t0;
        double f = Rand(380, 620);
        for (int i = 0; i < swings; i++)
        {
            double d = Rand(0.35, 0.7);
            bool up = i % 2 == 0;
            Tone(c, dest, t, "sawtooth", up ? f : f * 1.35, up ? f * 1.4 : f * 0.95, d, d * 0.3, 0.018);
            Tone(c, dest, t, "sine", up ? f * 2.02 : f * 2.7, up ? f * 2.8 : f * 1.9, d, d * 0.3, 0.02);
            t += d + Rand(0.1, 0.4);
        }
        return t - t0 + 0.2;
    };

    /// <summary>A gust of the great storm coming down the street: a rising roar with a howl in it, `k` 0..1 how hard, `secs` long.</summary>
    public static Make GustRoar(double k, double secs) => (c, dest, t0) =>
    {
        // the roar: low noise swelling and falling with the gust
        var src = c.Noise();
        var lp = c.Biquad("lowpass");
        lp.Frequency.SetValueAtTime(300, t0);
        lp.Frequency.LinearRampToValueAtTime(900 + 900 * k, t0 + secs * 0.45);
        lp.Frequency.LinearRampToValueAtTime(350, t0 + secs);
        var g = c.Gain();
        g.G.SetValueAtTime(0, t0);
        g.G.LinearRampToValueAtTime(0.35 * k, t0 + secs * 0.4);
        g.G.LinearRampToValueAtTime(0, t0 + secs);
        src.Connect(lp).Connect(g).Connect(dest);
        src.Start(t0, Rnd() * 2);
        src.Stop(t0 + secs + 0.1);
        // the howl round the corners: a narrow band that bends up and down
        var src2 = c.Noise();
        var bp = c.Biquad("bandpass", 350, 14);
        double f = Rand(420, 700);
        bp.Frequency.SetValueAtTime(f, t0);
        bp.Frequency.LinearRampToValueAtTime(f * Rand(1.4, 1.9), t0 + secs * 0.5);
        bp.Frequency.LinearRampToValueAtTime(f * Rand(0.9, 1.2), t0 + secs);
        var g2 = c.Gain();
        g2.G.SetValueAtTime(0, t0);
        g2.G.LinearRampToValueAtTime(0.5 * k, t0 + secs * 0.5);
        g2.G.LinearRampToValueAtTime(0, t0 + secs);
        src2.Connect(bp).Connect(g2).Connect(dest);
        src2.Start(t0, Rnd() * 2);
        src2.Stop(t0 + secs + 0.1);
        return secs + 0.2;
    };

    /// <summary>Something rolling and knocking over the stones in the wind: an empty cask, a bucket.</summary>
    public static Make RollingCask(double secs) => (c, dest, t0) =>
    {
        NoiseBurst(c, dest, t0, "lowpass", 220, 0.7, secs * 0.2, 0.18, secs * 0.6);
        int knocks = (int)Math.Round(secs * Rand(3, 6));
        for (int i = 0; i < knocks; i++)
        {
            double t = t0 + Rnd() * secs;
            Tone(c, dest, t, "triangle", Rand(110, 170), Rand(70, 100), 0.08, 0.002, Rand(0.08, 0.2));
            NoiseBurst(c, dest, t, "bandpass", Rand(600, 1100), 1.2, 0.002, Rand(0.05, 0.12), 0.05);
        }
        return secs + 0.4;
    };

    /// <summary>A storm wave slamming into the quay wall: the deep thump, the roar of it going up, the spray falling back. `k` 0..1 how big.</summary>
    public static Make WaveSlam(double k) => (c, dest, t0) =>
    {
        NoiseBurst(c, dest, t0, "lowpass", 140, 0.8, 0.01, 0.7 * k, 0.35);
        Tone(c, dest, t0, "sine", 70, 38, 0.4, 0.005, 0.35 * k);
        NoiseBurst(c, dest, t0 + 0.04, "bandpass", 900, 0.6, 0.05, 0.35 * k, 0.6);
        NoiseBurst(c, dest, t0 + 0.1, "highpass", 2500, 0.5, 0.2, 0.18 * k, 1.1);
        int drops = (int)Math.Round(20 + 40 * k);
        for (int i = 0; i < drops; i++)
        {
            double t = t0 + 0.6 + Rnd() * 1.4;
            NoiseBurst(c, dest, t, "bandpass", Rand(1500, 5000), 1.5, 0.002, Rand(0.02, 0.06) * k, Rand(0.02, 0.05));
        }
        return 2.4;
    };
}

/// <summary>
/// Thunder, built as it happens (audio/thunderSynth.ts, after Ribner and Roy, "Acoustics of thunder", 1982): the bolt
/// is a crooked channel from the ground up into the cloud, with branches and a long run inside the cloud; every few
/// metres of it sends one short shock (an N-wave). The pieces lie at different distances, so their cracks arrive one
/// after the other. Pure sums, no engine calls: it runs on a worker thread.
/// </summary>
public static class ThunderSynth
{
    public static float[] Build(double km, int sr)
    {
        double d0 = Math.Max(120, km * 1000);
        // the channel: listener at the origin, the strike's foot d0 away along +x
        var pts = new List<(double x, double y, double z)>();
        double x = d0, y = 0, z = 0;
        double top = Rand(3000, 4800);
        while (y < top)
        {
            pts.Add((x, y, z));
            double st = Rand(8, 30);
            x += Rand(-0.6, 0.6) * st;
            z += Rand(-0.6, 0.6) * st;
            y += Rand(0.45, 1) * st;
        }
        int trunk = pts.Count;
        // branches off the trunk, and the run through the cloud (the long far roll)
        for (int b = 0; b < 4; b++)
        {
            var (bx, by, bz) = pts[(int)Math.Floor(Rand(0.1, 0.8) * trunk)];
            int n0 = (int)Math.Floor(Rand(20, 70));
            double dx = Rand(-1, 1), dz = Rand(-1, 1);
            for (int i = 0; i < n0 && by > 0; i++)
            {
                double st = Rand(8, 25);
                bx += (dx + Rand(-0.5, 0.5)) * st;
                bz += (dz + Rand(-0.5, 0.5)) * st;
                by -= Rand(-0.2, 0.7) * st;
                pts.Add((bx, by, bz));
            }
        }
        {
            var (cx, cy, cz) = pts[trunk - 1];
            double ang = Rnd() * Math.PI * 2;
            double run = Rand(2000, 6000);
            for (double l = 0; l < run;)
            {
                double st = Rand(15, 40);
                cx += (Math.Cos(ang) + Rand(-0.6, 0.6)) * st;
                cz += (Math.Sin(ang) + Rand(-0.6, 0.6)) * st;
                cy += Rand(-0.3, 0.3) * st;
                l += st;
                pts.Add((cx, cy, cz));
            }
        }
        // each piece: its arrival, its loudness (1/r, more when it lies across the line of sight), its N-wave's length
        static double H3(double a, double b, double c) => Math.Sqrt(a * a + b * b + c * c);
        double first = H3(pts[0].x, pts[0].y, pts[0].z);
        var arr = new List<(double t, double a, double w)>();
        double tMax = 0;
        for (int i = 1; i < pts.Count; i++)
        {
            var (px, py, pz) = pts[i];
            var (qx, qy, qz) = pts[i - 1];
            double r = H3(px, py, pz);
            double sx = px - qx, sy = py - qy, sz = pz - qz;
            double sl = H3(sx, sy, sz);
            if (sl == 0) sl = 1;
            double cos = (sx * px + sy * py + sz * pz) / (sl * r);
            double across = Math.Sqrt(Math.Max(0.05, 1 - cos * cos));
            // (a shock stretches as it runs: longer, lower N-waves from farther pieces)
            double w = 0.004 * Math.Pow(r / 300, 0.35) * Rand(0.7, 1.4);
            double t = (r - first) / 343;
            // near: the channel by the ground is right there: its crack outdoes everything after it
            double crack = 1 + 4 * Math.Exp(-t / 0.3) * Math.Max(0, 1 - d0 / 1500);
            arr.Add((t, sl / r * across * (i < trunk ? 1 : 0.55) * crack, w));
            tMax = Math.Max(tMax, t);
        }
        // near thunder is over fast (the roll after it is soft); far thunder rolls on
        double len = Math.Min(d0 < 1000 ? 9 : 16, tMax + 1.5 + Math.Clamp((d0 - 1500) / 5000, 0, 1) * 6);
        int n = (int)Math.Ceiling(len * sr);
        var d = new float[n];
        foreach (var q in arr)
        {
            int i0 = (int)Math.Floor(q.t * sr);
            if (i0 >= n || i0 < 0) continue;
            // the shock: an N-wave
            int L = Math.Max(4, (int)Math.Floor(q.w * sr));
            for (int k = 0; k < L && i0 + k < n; k++) d[i0 + k] += (float)(q.a * 1.5 * (1 - 2.0 * k / L));
            // and the crackle of the piece itself: a short burst of noise, longer and softer from farther pieces
            int G = (int)Math.Floor((0.02 + 0.07 * Rnd()) * (1 + q.w * 120) * sr);
            double dec = 4.0 / G;
            for (int k = 0; k < G && i0 + k < n; k++) d[i0 + k] += (float)(q.a * (Rnd() * 2 - 1) * Math.Exp(-k * dec));
        }
        // the air eats the highs: a one-pole low pass by distance, and the body of it (a second, slower pass mixed in)
        double fc = 2600 / (1 + Math.Pow(d0 / 700, 1.3));
        double k1 = 1 - Math.Exp(-2 * Math.PI * fc / sr);
        double k2 = 1 - Math.Exp(-2 * Math.PI * 70 / sr);
        double y1 = 0, y1b = 0, y2 = 0;
        for (int i = 0; i < n; i++)
        {
            y1 += (d[i] - y1) * k1;
            y1b += (y1 - y1b) * k1;
            y2 += (y1b - y2) * k2;
            d[i] = (float)(y1b + y2 * (2 + d0 / 1200));
        }
        // far off, the roll comes back off the land and the clouds: echoes, later and duller, for seconds on end
        double far = Math.Clamp((d0 - 1500) / 5000, 0, 1);
        if (far > 0)
        {
            var src2 = (float[])d.Clone();
            for (int j = 0; j < 9; j++)
            {
                int D = (int)Math.Floor(Rand(0.4, 6) * sr);
                double gj = Rand(0.25, 0.6) * far * (1 - j / 12.0);
                double e = 0;
                double ke = 1 - Math.Exp(-2 * Math.PI * 160 / sr);
                for (int i = D; i < n; i++)
                {
                    e += (src2[i - D] - e) * ke;
                    d[i] += (float)(e * gj);
                }
            }
        }
        // the level by its loudest half second (not by one click)
        int W = sr / 2;
        double best = 1e-9, acc = 0;
        for (int i = 0; i < n; i++)
        {
            acc += d[i] * d[i];
            if (i >= W) acc -= d[i - W] * d[i - W];
            if (i >= W - 1) best = Math.Max(best, acc / W);
        }
        double rms = Math.Sqrt(best);
        double want = 0.42 / (1 + d0 / 2500);
        int tail = Math.Min(n, (int)Math.Floor(sr * 0.8));
        for (int i = 0; i < tail; i++) d[n - 1 - i] *= (float)i / tail;
        for (int i = 0; i < n; i++) d[i] = (float)(Math.Tanh(d[i] / rms * want * 1.3) * 0.95);
        return d;
    }
}

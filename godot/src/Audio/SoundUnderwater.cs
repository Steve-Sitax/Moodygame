using System;
using Godot;
using static Scheldemist.Audio.Wa;

namespace Scheldemist.Audio;

/// <summary>
/// Under the water (Player/Jef.Swim.cs, World/Underwater.cs): the whole town goes dull and far, as through the ears
/// full of water: a low cut over the master and a lower level, both eased so the surface is a soft line. And the
/// diver's own sounds, made in code: the air going out of him in bubbles, and the gasp when he comes up.
/// </summary>
public partial class Soundscape
{
    private AudioEffectLowPassFilter? underLp;
    private AudioEffectAmplify? underAmp;
    private int underLpAt = -1, underAmpAt = -1;
    private float underNow;

    /// <summary>How far under the water the ear is: 0 in the air, 1 under it (depth in metres makes it duller still).</summary>
    public void Underwater(float amount, float depth)
    {
        if (underLp == null)
        {
            if (amount <= 0) return;
            underLp = new AudioEffectLowPassFilter { CutoffHz = 20000, Resonance = 0.6f, Db = AudioEffectFilter.FilterDB.Filter12Db };
            underAmp = new AudioEffectAmplify { VolumeDb = 0 };
            AudioServer.AddBusEffect(0, underLp, 0);
            AudioServer.AddBusEffect(0, underAmp, 1);
            underLpAt = 0;
            underAmpAt = 1;
        }
        underNow = amount;
        bool on = amount > 0.001f;
        AudioServer.SetBusEffectEnabled(0, underLpAt, on);
        AudioServer.SetBusEffectEnabled(0, underAmpAt, on);
        if (!on) return;
        float cut = 520 / (1 + Math.Max(0, depth) * 0.25f);
        underLp.CutoffHz = Mathf.Lerp(20000, cut, amount);
        underAmp!.VolumeDb = -9 * amount;
    }

    /// <summary>A few bubbles of breath (quicker and more when the breath is nearly out).</summary>
    public void DiverBubbles(Vector3 at, bool hard)
    {
        var flat = FlatSpot(Bus("effects"));
        int n = hard ? 7 : 3 + (int)(Rnd() * 3);
        MadeAt(flat, (c, dest, t) =>
        {
            double when = 0;
            for (int i = 0; i < n; i++)
            {
                Bloop(c, dest, t + when, Rand(260, 520) * (1 + i * 0.06), Rand(0.05, 0.09), Rand(0.12, 0.22));
                when += Rand(0.05, hard ? 0.11 : 0.18);
            }
            return when + 0.12;
        }, "bubbles", 0.8);
    }

    /// <summary>Coming up: a deep breath in (a hard, ragged one when the breath had run out).</summary>
    public void Gasp(bool hard)
    {
        var flat = FlatSpot(Bus("effects"));
        MadeAt(flat, (c, dest, t) =>
        {
            Breathe(c, dest, t, hard ? 0.55 : 0.42, hard ? 0.5 : 0.32);
            if (!hard) return 0.5;
            Breathe(c, dest, t + 0.75, 0.38, 0.28);
            Breathe(c, dest, t + 1.35, 0.45, 0.3);
            return 1.9;
        }, "gasp", 0.9);
    }

    private static void Bloop(Wa c, Wa.Node dest, double t, double f, double dur, double vol)
    {
        var o = c.Osc("sine");
        o.Frequency.SetValueAtTime(f, t);
        o.Frequency.ExponentialRampToValueAtTime(f * 2.4, t + dur);
        var env = c.Gain();
        env.G.SetValueAtTime(0, t);
        env.G.LinearRampToValueAtTime(vol, t + 0.006);
        env.G.ExponentialRampToValueAtTime(0.001, t + dur);
        o.Connect(env).Connect(dest);
        o.Start(t);
        o.Stop(t + dur + 0.02);
    }

    private static void Breathe(Wa c, Wa.Node dest, double t, double dur, double vol)
    {
        var src = c.Noise();
        var f = c.Biquad("bandpass", 1400, 0.9);
        f.Frequency.SetValueAtTime(900, t);
        f.Frequency.LinearRampToValueAtTime(2300, t + dur);
        var env = c.Gain();
        env.G.SetValueAtTime(0, t);
        env.G.LinearRampToValueAtTime(vol, t + dur * 0.7);
        env.G.LinearRampToValueAtTime(0, t + dur);
        src.Connect(f).Connect(env).Connect(dest);
        src.Start(t, Rnd() * 2);
        src.Stop(t + dur + 0.02);
    }
}

using System;
using System.Collections.Generic;

namespace Scheldemist.Audio;

/// <summary>
/// A small Web Audio that runs ahead of time: the browser's made sounds (client/src/audio/*.ts) are graphs of
/// oscillators, noise, biquad filters and gains with timed values. The same graph is built here with the same
/// numbers and rendered to a buffer, so a made sound is the same sound. The filter formulas and the AudioParam
/// timeline (setValueAtTime, the ramps, setTargetAtTime, value curves) are the Web Audio specification's.
/// One graph is built on one thread and rendered on one thread; the noise buffers are shared and never written.
/// </summary>
public sealed class Wa
{
    public const int Q = 128;
    public readonly int Rate;
    public readonly GainNode Destination;
    internal long Quantum;
    internal long Frame;
    internal static readonly float[] Zero = new float[Q];

    public Wa(int rate)
    {
        Rate = rate;
        Destination = new GainNode(this, 1);
    }

    /// <summary>The browser's makeNoise: 3 s of white, 4 s of brown, made once.</summary>
    public static readonly float[] White = MakeNoise(3, false);
    public static readonly float[] Brown = MakeNoise(4, true);
    public const int NoiseRate = 44100;

    private static float[] MakeNoise(int seconds, bool brown)
    {
        var r = new Random(brown ? 1873 : 1874);
        var d = new float[NoiseRate * seconds];
        double last = 0;
        for (int i = 0; i < d.Length; i++)
        {
            double w = r.NextDouble() * 2 - 1;
            if (!brown) d[i] = (float)w;
            else
            {
                last = (last + 0.02 * w) / 1.02;
                d[i] = (float)(last * 3.5);
            }
        }
        return d;
    }

    public static double Rand(double a, double b) => a + Random.Shared.NextDouble() * (b - a);
    public static double Rnd() => Random.Shared.NextDouble();
    public static T Pick<T>(IReadOnlyList<T> xs) => xs[(int)Math.Floor(Rnd() * xs.Count) % xs.Count];

    public GainNode Gain(double v = 1) => new(this, v);
    public OscNode Osc(string type, double freq = 440) => new(this, type, freq);
    public BiquadNode Biquad(string type, double freq = 350, double q = 1) => new(this, type, freq, q);
    /// <summary>A buffer source on the white noise (the browser's `noise` argument).</summary>
    public SrcNode Noise(bool loop = true) => new(this, White, NoiseRate) { Loop = loop };
    public SrcNode Src(float[] buffer, int rate) => new(this, buffer, rate);
    /// <summary>A buffer that is built when the sound is rendered (thunder: 20 to 60 ms of sums, off the main thread).</summary>
    public SrcNode Src(Func<float[]> build, int rate) => new(this, build, rate);

    /// <summary>
    /// A recording that plays beside the made part (a cue's bell, a recorded thunderclap): the soundscape plays it at
    /// the same place. Times in seconds from the sound's start; `Lowpass` 0: none.
    /// </summary>
    public sealed record Extra(string Sample, double At, double From, double Secs, double Rate, double Gain, double Fade, double Lowpass = 0);
    public readonly List<Extra> Extras = new();
    /// <summary>A recording's length in seconds by its name, below 0 when it is not loaded (the soundscape sets it).</summary>
    public Func<string, double> SampleSeconds = _ => -1;

    /// <summary>Render from time 0 for `seconds`: what reached the destination.</summary>
    public float[] Render(double seconds)
    {
        int n = Math.Max(Q, (int)Math.Ceiling(seconds * Rate));
        var o = new float[n];
        for (Frame = 0, Quantum = 0; Frame < n; Frame += Q, Quantum++)
        {
            var b = Destination.Pull();
            if (b != null) Array.Copy(b, 0, o, Frame, Math.Min(Q, n - Frame));
        }
        return o;
    }

    /// <summary>
    /// A biquad's coefficients by the Web Audio formulas (a0 divided out): lowpass and highpass take Q in dB,
    /// bandpass and peaking a plain Q; `gain` in dB is the peaking filter's.
    /// </summary>
    public static (double b0, double b1, double b2, double a1, double a2) BiquadCoefs(string type, double f, double q, double gain, int rate)
    {
        f = Math.Clamp(f, 1, rate * 0.49);
        double w = 2 * Math.PI * f / rate, cs = Math.Cos(w), sn = Math.Sin(w), a0, b0, b1, b2, a1, a2;
        switch (type)
        {
            case "lowpass":
                {
                    double al = sn / (2 * Math.Pow(10, q / 20));
                    a0 = 1 + al; b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a1 = -2 * cs; a2 = 1 - al;
                    break;
                }
            case "highpass":
                {
                    double al = sn / (2 * Math.Pow(10, q / 20));
                    a0 = 1 + al; b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a1 = -2 * cs; a2 = 1 - al;
                    break;
                }
            case "peaking":
                {
                    double al = sn / (2 * Math.Max(1e-4, q)), A = Math.Pow(10, gain / 40);
                    a0 = 1 + al / A; b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a1 = -2 * cs; a2 = 1 - al / A;
                    break;
                }
            default: // bandpass
                {
                    double al = sn / (2 * Math.Max(1e-4, q));
                    a0 = 1 + al; b0 = al; b1 = 0; b2 = -al; a1 = -2 * cs; a2 = 1 - al;
                    break;
                }
        }
        return (b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
    }

    // ------------------------------------------------------------------ AudioParam

    public sealed class Param
    {
        private enum K { Set, Lin, Exp, Target, Curve }
        private sealed class Ev
        {
            public K Kind;
            public double T, V, Tau, Dur;
            public float[]? Curve;
            public double V0 = double.NaN;
            public double End => Kind == K.Curve ? T + Dur : T;
        }

        public double Value;
        private readonly List<Ev> evs = new();
        internal readonly List<Node> Mods = new();
        private int hint = -1;
        private readonly float[] vals = new float[Q];

        public Param(double v) => Value = v;
        public bool Const => evs.Count == 0 && Mods.Count == 0;

        private void Add(Ev e)
        {
            if (!double.IsFinite(e.T) || !double.IsFinite(e.V)) return; // (the browser's safeParams: a bad value is skipped)
            int i = evs.Count;
            while (i > 0 && evs[i - 1].T > e.T) i--;
            evs.Insert(i, e);
        }
        public Param SetValueAtTime(double v, double t) { Add(new Ev { Kind = K.Set, V = v, T = Math.Max(0, t) }); return this; }
        public Param LinearRampToValueAtTime(double v, double t) { Add(new Ev { Kind = K.Lin, V = v, T = Math.Max(0, t) }); return this; }
        public Param ExponentialRampToValueAtTime(double v, double t) { Add(new Ev { Kind = K.Exp, V = v, T = Math.Max(0, t) }); return this; }
        public Param SetTargetAtTime(double v, double t, double tau) { Add(new Ev { Kind = K.Target, V = v, T = Math.Max(0, t), Tau = Math.Max(1e-6, tau) }); return this; }
        public Param SetValueCurveAtTime(float[] curve, double t, double dur) { if (curve.Length > 0) Add(new Ev { Kind = K.Curve, V = curve[^1], T = Math.Max(0, t), Dur = Math.Max(1e-6, dur), Curve = curve }); return this; }
        public Param CancelScheduledValues(double t) { evs.RemoveAll(e => e.T >= t); return this; }

        /// <summary>The value with event `i` the last one at or before `t` (-1: none yet).</summary>
        private double At(int i, double t)
        {
            if (i + 1 < evs.Count && evs[i + 1].Kind is K.Lin or K.Exp)
            {
                var n = evs[i + 1];
                double t0 = i < 0 ? 0 : evs[i].End;
                if (t >= t0)
                {
                    double v0 = i < 0 ? Value : EndValue(i);
                    double k = n.T > t0 ? (t - t0) / (n.T - t0) : 1;
                    if (n.Kind == K.Lin) return v0 + (n.V - v0) * k;
                    return v0 > 0 == n.V > 0 && v0 != 0 && n.V != 0 ? v0 * Math.Pow(n.V / v0, k) : v0;
                }
            }
            if (i < 0) return Value;
            var e = evs[i];
            switch (e.Kind)
            {
                // (twenty time constants on, it is there: no exponential to work out)
                case K.Target: return t - e.T > 20 * e.Tau ? e.V : e.V + (Start(i) - e.V) * Math.Exp(-(t - e.T) / e.Tau);
                case K.Curve:
                    {
                        var c = e.Curve!;
                        double p = Math.Min(1, (t - e.T) / e.Dur) * (c.Length - 1);
                        int a = Math.Min(c.Length - 1, (int)p);
                        int b = Math.Min(c.Length - 1, a + 1);
                        return c[a] + (c[b] - c[a]) * (p - a);
                    }
                default: return e.V;
            }
        }

        /// <summary>The value just as event `i` begins (a setTarget starts from where the value is).</summary>
        private double Start(int i)
        {
            var e = evs[i];
            if (double.IsNaN(e.V0)) e.V0 = At(i - 1, e.T);
            return e.V0;
        }

        private double EndValue(int i) => evs[i].Kind == K.Target ? Start(i) : evs[i].V;

        public double Eval(double t)
        {
            if (hint >= evs.Count || (hint >= 0 && evs[hint].T > t)) hint = -1;
            while (hint + 1 < evs.Count && evs[hint + 1].T <= t) hint++;
            return At(hint, t);
        }

        /// <summary>This quantum's values, sample by sample (the timeline plus what is connected to the param).</summary>
        internal float[] Fill(Wa c)
        {
            double dt = 1.0 / c.Rate;
            if (evs.Count == 0) Array.Fill(vals, (float)Value);
            else for (int i = 0; i < Q; i++) vals[i] = (float)Eval((c.Frame + i) * dt);
            foreach (var m in Mods)
            {
                var b = m.Pull();
                if (b != null) for (int i = 0; i < Q; i++) vals[i] += b[i];
            }
            return vals;
        }
    }

    // ------------------------------------------------------------------ nodes

    public abstract class Node
    {
        public readonly Wa C;
        private readonly List<Node> ins = new();
        private readonly float[] buf = new float[Q];
        private float[]? sum;
        private long stamp = -1;
        private bool silent;

        protected Node(Wa c) => C = c;
        public bool HasInputs => ins.Count > 0;

        /// <summary>As in Web Audio: returns the node connected to, so chains read the same.</summary>
        public T Connect<T>(T dest) where T : Node
        {
            dest.ins.Add(this);
            return dest;
        }
        public void Connect(Param p) => p.Mods.Add(this);

        /// <summary>This quantum's output, or null when it is silent.</summary>
        internal float[]? Pull()
        {
            if (stamp == C.Quantum) return silent ? null : buf;
            stamp = C.Quantum;
            float[]? input = null;
            int live = 0;
            foreach (var n in ins)
            {
                var b = n.Pull();
                if (b == null) continue;
                if (live == 0) input = b;
                else
                {
                    sum ??= new float[Q];
                    if (live == 1) Array.Copy(input!, sum, Q);
                    for (int i = 0; i < Q; i++) sum[i] += b[i];
                    input = sum;
                }
                live++;
            }
            silent = !Process(input, buf);
            return silent ? null : buf;
        }

        /// <summary>Write the output; false when it is silent.</summary>
        protected abstract bool Process(float[]? input, float[] output);
    }

    public sealed class GainNode : Node
    {
        public readonly Param G;
        public GainNode(Wa c, double v) : base(c) => G = new Param(v);

        protected override bool Process(float[]? input, float[] o)
        {
            if (input == null) return false;
            if (G.Const)
            {
                float g = (float)G.Value;
                for (int i = 0; i < Q; i++) o[i] = input[i] * g;
            }
            else
            {
                var g = G.Fill(C);
                for (int i = 0; i < Q; i++) o[i] = input[i] * g[i];
            }
            return true;
        }
    }

    /// <summary>An oscillator: sine, sawtooth, square, triangle with Web Audio's phases; the hard edges are rounded (polyBLEP) as the browser's band-limited waves are.</summary>
    public sealed class OscNode : Node
    {
        public readonly string Type;
        public readonly Param Frequency;
        public double Detune;
        private double start = double.PositiveInfinity, stop = double.PositiveInfinity;
        private double phase;

        public OscNode(Wa c, string type, double f) : base(c)
        {
            Type = type;
            Frequency = new Param(f);
        }
        public void Start(double t = 0) => start = Math.Max(0, t);
        public void Stop(double t) => stop = t;

        private static double Blep(double p, double dp)
        {
            if (p < dp) { double x = p / dp; return x + x - x * x - 1; }
            if (p > 1 - dp) { double x = (p - 1) / dp; return x * x + x + x + 1; }
            return 0;
        }

        protected override bool Process(float[]? input, float[] o)
        {
            double dt = 1.0 / C.Rate, t0 = C.Frame * dt;
            if (t0 + Q * dt <= start || t0 >= stop) return false;
            var f = Frequency.Const ? null : Frequency.Fill(C);
            double det = Detune == 0 ? 1 : Math.Pow(2, Detune / 1200);
            for (int i = 0; i < Q; i++)
            {
                double t = t0 + i * dt;
                if (t < start || t >= stop) { o[i] = 0; continue; }
                double dp = Math.Min(0.5, Math.Abs((f != null ? f[i] : Frequency.Value) * det * dt));
                double p = phase, v;
                switch (Type)
                {
                    case "sawtooth":
                        {
                            double q = p + 0.5;
                            if (q >= 1) q -= 1;
                            v = 2 * q - 1 - Blep(q, dp);
                            break;
                        }
                    case "square":
                        {
                            double q = p + 0.5;
                            if (q >= 1) q -= 1;
                            v = (p < 0.5 ? 1 : -1) + Blep(p, dp) - Blep(q, dp);
                            break;
                        }
                    case "triangle": v = p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4; break;
                    default: v = Math.Sin(2 * Math.PI * p); break;
                }
                o[i] = (float)v;
                phase += dp;
                if (phase >= 1) phase -= 1;
            }
            return true;
        }
    }

    /// <summary>A buffer source (the noise, a built clap): start(when, offset, duration), loop, playbackRate.</summary>
    public sealed class SrcNode : Node
    {
        private float[] data;
        private Func<float[]>? lazy;
        private readonly int rate;
        public bool Loop;
        public double PlaybackRate = 1;
        private double start = double.PositiveInfinity, stop = double.PositiveInfinity, pos;

        public SrcNode(Wa c, float[] data, int rate) : base(c)
        {
            this.data = data;
            this.rate = rate;
        }
        public SrcNode(Wa c, Func<float[]> build, int rate) : base(c)
        {
            data = Array.Empty<float>();
            lazy = build;
            this.rate = rate;
        }
        public double Duration => (double)data.Length / rate;
        public void Start(double t = 0, double offset = 0, double duration = double.PositiveInfinity)
        {
            start = Math.Max(0, t);
            pos = Math.Max(0, offset) * rate;
            if (Loop && data.Length > 0) pos %= data.Length;
            if (!double.IsInfinity(duration)) stop = Math.Min(stop, start + duration / Math.Max(1e-6, PlaybackRate));
        }
        public void Stop(double t) => stop = Math.Min(stop, t);

        protected override bool Process(float[]? input, float[] o)
        {
            double dt = 1.0 / C.Rate, t0 = C.Frame * dt;
            if (t0 + Q * dt <= start || t0 >= stop) return false;
            if (lazy != null)
            {
                data = lazy();
                lazy = null;
            }
            if (data.Length < 2) return false;
            double step = PlaybackRate * rate * dt;
            int n = data.Length;
            bool any = false;
            for (int i = 0; i < Q; i++)
            {
                double t = t0 + i * dt;
                if (t < start || t >= stop || (!Loop && pos >= n - 1)) { o[i] = 0; continue; }
                int a = (int)pos;
                int b = a + 1 < n ? a + 1 : 0;
                o[i] = (float)(data[a] + (data[b] - data[a]) * (pos - a));
                pos += step;
                if (Loop && pos >= n) pos -= n;
                any = true;
            }
            return any;
        }
    }

    /// <summary>A biquad filter with the Web Audio formulas: lowpass and highpass take Q in dB, bandpass and peaking a plain Q.</summary>
    public sealed class BiquadNode : Node
    {
        public readonly string Type;
        public readonly Param Frequency, Qp, GainDb;
        private double b0, b1, b2, a1, a2, x1, x2, y1, y2;
        private bool made;

        public BiquadNode(Wa c, string type, double f, double q) : base(c)
        {
            Type = type;
            Frequency = new Param(f);
            Qp = new Param(q);
            GainDb = new Param(0);
        }

        private void Coef(double f, double q, double gain) => (b0, b1, b2, a1, a2) = BiquadCoefs(Type, f, q, gain, C.Rate);

        protected override bool Process(float[]? input, float[] o)
        {
            if (input == null && Math.Abs(y1) + Math.Abs(y2) < 1e-7)
            {
                x1 = x2 = y1 = y2 = 0;
                return false;
            }
            bool moving = !Frequency.Const || !Qp.Const;
            var f = moving ? Frequency.Fill(C) : null;
            var q = moving ? Qp.Fill(C) : null;
            if (!moving && !made)
            {
                Coef(Frequency.Value, Qp.Value, GainDb.Value);
                made = true;
            }
            var x = input ?? Zero;
            for (int i = 0; i < Q; i++)
            {
                if (moving && (i & 15) == 0) Coef(f![i], q![i], GainDb.Value);
                double xi = x[i];
                double y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
                x2 = x1; x1 = xi; y2 = y1; y1 = y;
                o[i] = (float)y;
            }
            return true;
        }
    }
}

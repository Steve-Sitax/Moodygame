using System;
using System.Collections.Generic;
using Godot;
using static Scheldemist.Audio.Wa;

namespace Scheldemist.Audio;

/// <summary>
/// The Ruien under the street (docs/ruien-native.md, Sound): the vaults' long echo, wetter deep in a gallery and drier
/// by an opening; drops falling from the vault joints and pipe mouths; the side drains' spouts pouring into the
/// channel. Every source sits at its own place with its own reach (3D distance: the street above does not hear them).
/// </summary>
public partial class Soundscape
{
    /// <summary>A placed water sound underground: "drip" (one drop now and then) or "spill" (a steady pour).</summary>
    public sealed class RuienPoint
    {
        public string Kind = "drip";
        public Vector3 At;
        /// <summary>Metres: full level at the source, fading from 0.6 of it, silent beyond (Spot.Max).</summary>
        public double Reach = 6;
        public double Gain = 1;
        /// <summary>Intermittent pours, such as the flushing sluice, are silent while dry.</summary>
        public Func<bool>? Flowing;
        /// <summary>Drips: seconds between drops, at least and at most.</summary>
        public double Min = 2.5, Max = 8;
        internal double Next;
    }

    /// <summary>The Ruien part's sound places (set once it has read its areas); null until then.</summary>
    public static IReadOnlyList<RuienPoint>? RuienPoints { get; set; }
    /// <summary>Dev (reach measurement): only this place of RuienPoints sounds; -1 all.</summary>
    public static int RuienSolo { get; set; } = -1;
    /// <summary>The Ruien part: 0 deep under a vault .. 1 at an opening to the street, for the echo's wetness.</summary>
    public static Func<Vector3, double>? RuienOpenAt { get; set; }

    private double ruienOpen = -1;
    private readonly Dictionary<RuienPoint, (Spot spot, string bus)> ruienPours = new();

    /// <summary>Four times a second while in the Ruien: the echo dries out towards an opening.</summary>
    private void RuienEcho()
    {
        if (roomKind != "ruien" || RuienOpenAt == null) { ruienOpen = -1; return; }
        double open = Math.Clamp(RuienOpenAt(listenerPos), 0, 1);
        if (Math.Abs(open - ruienOpen) < 0.02) return;
        ruienOpen = open;
        var hall = Halls["ruien"];
        double t60 = hall[0] * (1 - Math.Pow(10, -3 / hall[1])) * (1 - 0.45 * open);
        double wet = hall[2] * ConvolverGain(hall[0]) * (1 - 0.55 * open);
        SetVerb(hallVerb, t60, wet);
    }

    /// <summary>Dev: the Ruien echo's wetness now (0..1 of the gallery's), and its places' gains at the ear.</summary>
    public double RuienEchoOpen => ruienOpen;

    /// <summary>Every frame: drips fall at their times; the spouts' pours sound within their reach.</summary>
    private void RuienWater()
    {
        var points = RuienPoints;
        if (points == null || points.Count == 0) return;
        bool inRuien = roomKind == "ruien";
        string bus = inRuien ? "RoomAmbience" : Bus("ambience");
        for (int i = 0; i < points.Count; i++)
        {
            var p = points[i];
            bool muted = RuienSolo >= 0 && RuienSolo != i;
            double d = muted ? double.PositiveInfinity : DistTo(p.At.X, p.At.Y, p.At.Z);
            if (p.Kind == "spill")
            {
                bool want = Auto && d < p.Reach + 1 && (p.Flowing?.Invoke() ?? true) && buf.ContainsKey("ruienSpill");
                bool have = ruienPours.TryGetValue(p, out var pour);
                if (have && (!want || pour.bus != bus))
                {
                    FadeDrop(pour.spot, 0.3, 1.2);
                    ruienPours.Remove(p);
                    have = false;
                }
                if (want && !have)
                {
                    var b = buf["ruienSpill"];
                    var sp = NewSpot(p.At.X, p.At.Y, p.At.Z, 0.8, 1.6, 40, 0, 14000, bus, p.Reach, 0);
                    sp.Hold = true;
                    (sp.Level, sp.LevelT, sp.LevelTau) = (0, 1, 0.5);
                    Add(sp, b, "ruien spill", p.Gain, Rand(0.94, 1.06), Rnd() * Math.Max(0, b.GetLength() - 0.1));
                    ruienPours[p] = (sp, bus);
                }
                continue;
            }
            if (now < p.Next) continue;
            p.Next = now + Rand(p.Min, p.Max);
            if (!Auto || !(d < p.Reach) || !buf.TryGetValue("ruienDrips", out var drips)) continue;
            var (from, len, level) = Pick(Samples.RuienDripSpans);
            var spot = NewSpot(p.At.X, p.At.Y, p.At.Z, 0.8, 1.4, 40, 0, 14000, bus, p.Reach, 0);
            double f = 0.01;
            Add(spot, drips, "ruien drip", p.Gain * level, Rand(0.9, 1.12), from, len, 0, new Env((0, 0), (f, 1), (len - 0.25, 1), (len, 0)));
        }
    }

    /// <summary>Dev: each Ruien place's gain at the ear now (distance m, the spot's level x fog x panner); NaN when silent.</summary>
    public List<(string kind, Vector3 at, double d, double gain)> RuienProbe()
    {
        var list = new List<(string, Vector3, double, double)>();
        if (RuienPoints == null) return list;
        foreach (var p in RuienPoints)
        {
            double d = DistTo(p.At.X, p.At.Y, p.At.Z);
            // the gain a voice on this place gets (VoiceGain without the recording's own level): edge x panner
            double edge = 1 - Ramp(d, p.Reach * 0.6, p.Reach);
            double pan = Inverse(d, 0.8, p.Kind == "spill" ? 1.6 : 1.4) * PanMakeup;
            list.Add((p.Kind, p.At, d, d < p.Reach ? edge * pan * FogLoss(d) : 0));
        }
        return list;
    }
}

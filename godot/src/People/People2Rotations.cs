using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.People;

// Keep authored linear keys in managed memory; crossing into Godot once per bone dominates a crowd's sampler.
// Other interpolation modes and boundary times keep the engine's sampler.
internal sealed class People2Rotations
{
    // Exported joints usually share their key times. Resolve a clock once per pose,
    // then reuse that exact interval and weight for the other joints on the main thread.
    private sealed class Clock
    {
        internal readonly double[] Times;
        private readonly double searchScale;
        private double lastTime = double.NaN;
        private int index;
        private float weight;
        internal Clock(double[] times)
        {
            Times = times;
            searchScale = times.Length > 1 ? (times.Length - 1) / (times[^1] - times[0]) : 0;
        }
        internal int Find(double time, out float blend)
        {
            if (time != lastTime)
            {
                index = Math.Clamp((int)((time - Times[0]) * searchScale), 0, Times.Length - 1);
                while (index > 0 && Times[index] > time) index--;
                while (index + 1 < Times.Length && Times[index + 1] <= time) index++;
                weight = Times[index] == time ? 0 : (float)((time - Times[index]) / (Times[index + 1] - Times[index]));
                lastTime = time;
            }
            blend = weight;
            return index;
        }
    }
    // These depend only on the authored keys, not on a person's animation phase.
    private readonly record struct Arc(float Angle, float Sine, bool Negate, bool Same);
    private sealed record Track(Clock Clock, Quaternion[] Values, bool Constant, Quaternion NormalizedConstant, Arc[] Arcs)
    {
        internal double[] Times => Clock.Times;
    }
    private readonly Animation animation;
    private readonly Track?[] tracks;
    private readonly double length;
    internal People2Rotations(Animation animation)
    {
        this.animation = animation; length = animation.Length;
        tracks = new Track?[animation.GetTrackCount()];
        var clocks = new List<Clock>();
        for (int t = 0; t < tracks.Length; t++)
        {
            if (animation.TrackGetType(t) != Animation.TrackType.Rotation3D) continue;
            int count = animation.TrackGetKeyCount(t);
            if (count == 0) continue;
            var times = new double[count]; var values = new Quaternion[count];
            bool eligible = animation.TrackGetInterpolationType(t) == Animation.InterpolationType.Linear;
            bool ordered = true;
            for (int k = 0; k < count; k++)
            {
                times[k] = animation.TrackGetKeyTime(t, k);
                values[k] = animation.TrackGetKeyValue(t, k).AsQuaternion();
                if (animation.TrackGetKeyTransition(t, k) != 1 || k > 0 && times[k] <= times[k - 1]) eligible = false;
                if (k > 0 && times[k] <= times[k - 1]) ordered = false;
            }
            bool constant = true;
            for (int k = 1; k < count; k++) if (values[k] != values[0]) { constant = false; break; }
            if (eligible || constant && ordered)
            {
                var clock = clocks.Find(c => c.Times.AsSpan().SequenceEqual(times));
                if (clock == null) { clock = new Clock(times); clocks.Add(clock); }
                var arcs = constant ? Array.Empty<Arc>() : new Arc[count - 1];
                for (int k = 0; k < arcs.Length; k++)
                {
                    float cosine = values[k].Dot(values[k + 1]);
                    bool negate = cosine < 0;
                    if (negate) cosine = -cosine;
                    // Keep Godot Quaternion.Slerp's threshold and arithmetic, moving
                    // only its invariant acos/sin out of the per-person sample.
                    float angle = 1.0 - cosine > Mathf.Epsilon ? Mathf.Acos(cosine) : 0;
                    arcs[k] = new Arc(angle, angle == 0 ? 0 : Mathf.Sin(angle), negate, values[k] == values[k + 1]);
                }
                tracks[t] = new Track(clock, values, constant, values[0].Normalized(), arcs);
            }
        }
    }
    // Normalize invariant curves once; use the runtime's vector math for changing poses.
    internal Quaternion NormalizedAt(int track, double time) => tracks[track] is { Constant: true } keys && time >= 0 && time <= length
        ? keys.NormalizedConstant : Normalize(At(track, time));
    private static Quaternion Normalize(Quaternion q)
    {
        var v = System.Numerics.Vector4.Normalize(new(q.X, q.Y, q.Z, q.W));
        return new(v.X, v.Y, v.Z, v.W);
    }
    // Identical rotations need no interpolation. Apart from the wasted arithmetic,
    // weighted sums of equal floats can jitter enough to defeat the authored-pose cache.
    internal static Quaternion Blend(Quaternion from, Quaternion to, float weight)
    {
        if (from == to) return from;
        var q = System.Numerics.Quaternion.Slerp(new(from.X, from.Y, from.Z, from.W),
            new(to.X, to.Y, to.Z, to.W), weight);
        return new(q.X, q.Y, q.Z, q.W);
    }
    internal Quaternion At(int track, double time)
    {
        var keys = tracks[track];
        // A constant curve remains constant for every interpolation/transition, including its endpoints.
        if (keys is { Constant: true } && time >= 0 && time <= length) return keys.Values[0];
        if (keys == null || time <= 0 || time >= length) return animation.RotationTrackInterpolate(track, time);
        if (keys.Values.Length == 1) return keys.Values[0];
        // Sparse tracks can leave a gap at the loop seam; retain the engine's wrap there.
        if (time < keys.Times[0] || time > keys.Times[^1]) return animation.RotationTrackInterpolate(track, time);
        // Dense exported finger/rest tracks often repeat exactly. Preserve their value without a search or slerp.
        if (keys.Constant) return keys.Values[0];
        int at = keys.Clock.Find(time, out float weight);
        if (weight == 0) return keys.Values[at];
        ref readonly var arc = ref keys.Arcs[at];
        var from = keys.Values[at];
        if (arc.Same) return from;
        var to = arc.Negate ? -keys.Values[at + 1] : keys.Values[at + 1];
        float a = 1 - weight, b = weight;
        if (arc.Sine != 0)
        {
            a = Mathf.Sin(a * arc.Angle) / arc.Sine;
            b = Mathf.Sin(b * arc.Angle) / arc.Sine;
        }
        return new Quaternion(a * from.X + b * to.X, a * from.Y + b * to.Y,
            a * from.Z + b * to.Z, a * from.W + b * to.W);
    }
    internal (int Tracks, int Samples, float Error) Verify()
    {
        int count = 0, samples = 0; float error = 0;
        for (int t = 0; t < tracks.Length; t++)
        {
            if (tracks[t] is not { } keys) continue;
            count++;
            Compare(0); Compare(length); Compare(length * .25); Compare(length * .75);
            for (int k = 0; k < keys.Times.Length; k++)
            {
                Compare(keys.Times[k]);
                if (k > 0)
                {
                    double start = keys.Times[k - 1], span = keys.Times[k] - start;
                    Compare(start + span * .25); Compare(start + span * .5); Compare(start + span * .75);
                }
            }
            void Compare(double time)
            {
                var actual = NormalizedAt(t, time);
                var expected = animation.RotationTrackInterpolate(t, time).Normalized();
                if (actual.Dot(expected) < 0) expected = -expected;
                error = Math.Max(error, Math.Max(Math.Max(Math.Abs(actual.X - expected.X), Math.Abs(actual.Y - expected.Y)),
                    Math.Max(Math.Abs(actual.Z - expected.Z), Math.Abs(actual.W - expected.W))));
                samples++;
                // Exercise the cross-clip blend too, including opposite quaternion signs.
                for (int mix = 0; mix < 3; mix++)
                {
                    float weight = mix == 0 ? .17f : mix == 1 ? .5f : .83f;
                    var target = keys.NormalizedConstant;
                    if (weight > .5f) target = -target;
                    var mixed = Blend(actual, target, weight);
                    var reference = expected.Slerp(target, weight);
                    if (mixed.Dot(reference) < 0) reference = -reference;
                    error = Math.Max(error, Math.Max(Math.Max(Math.Abs(mixed.X - reference.X), Math.Abs(mixed.Y - reference.Y)),
                        Math.Max(Math.Abs(mixed.Z - reference.Z), Math.Abs(mixed.W - reference.W))));
                    samples++;
                }
            }
        }
        return (count, samples, error);
    }
}

using System;
using Godot;

namespace Scheldemist.People;

// Keep authored linear keys in managed memory; crossing into Godot once per bone dominates a crowd's sampler.
// Other interpolation modes and boundary times keep the engine's sampler.
internal sealed class People2Rotations
{
    private sealed record Track(double[] Times, Quaternion[] Values, bool Constant, Quaternion NormalizedConstant, double SearchScale);
    private readonly Animation animation;
    private readonly Track?[] tracks;
    private readonly double length;
    internal People2Rotations(Animation animation)
    {
        this.animation = animation; length = animation.Length;
        tracks = new Track?[animation.GetTrackCount()];
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
            if (eligible || constant && ordered) tracks[t] = new Track(times, values, constant, values[0].Normalized(),
                count > 1 ? (count - 1) / (times[^1] - times[0]) : 0);
        }
    }
    // Normalize invariant authored curves once. Dynamic interpolation keeps exactly the existing arithmetic.
    internal Quaternion NormalizedAt(int track, double time) => tracks[track] is { Constant: true } keys && time >= 0 && time <= length
        ? keys.NormalizedConstant : At(track, time).Normalized();
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
        // Exported curves are dense and nearly uniform. Guess the interval, then check its real
        // boundaries; sparse/irregular curves still get exactly the same key and interpolation weight.
        int at = Math.Clamp((int)((time - keys.Times[0]) * keys.SearchScale), 0, keys.Times.Length - 1);
        while (at > 0 && keys.Times[at] > time) at--;
        while (at + 1 < keys.Times.Length && keys.Times[at + 1] <= time) at++;
        if (keys.Times[at] == time) return keys.Values[at];
        int previous = at, next = at + 1;
        float weight = (float)((time - keys.Times[previous]) / (keys.Times[next] - keys.Times[previous]));
        return keys.Values[previous].Slerp(keys.Values[next], weight);
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
                if (k > 0) Compare((keys.Times[k - 1] + keys.Times[k]) * .5);
            }
            void Compare(double time)
            {
                var actual = NormalizedAt(t, time);
                var expected = animation.RotationTrackInterpolate(t, time).Normalized();
                if (actual.Dot(expected) < 0) expected = -expected;
                error = Math.Max(error, Math.Max(Math.Max(Math.Abs(actual.X - expected.X), Math.Abs(actual.Y - expected.Y)),
                    Math.Max(Math.Abs(actual.Z - expected.Z), Math.Abs(actual.W - expected.W))));
                samples++;
            }
        }
        return (count, samples, error);
    }
}

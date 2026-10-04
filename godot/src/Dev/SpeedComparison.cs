using System;
using Scheldemist.Town;

namespace Scheldemist.Dev;

/// <summary>Original paths for same-state pixel and pure-calculation comparisons.</summary>
public static class SpeedComparison
{
    public static bool Cached { get; set; } = !Main.I.Flag("perf2-original");
    public static object ScheduleProof()
    {
        var town = Kit.I.People!.Data!;
        int checkedAnswers = 0, different = 0;
        foreach (var r in town.Residents)
        for (int day = 1; day <= 7; day++)
        {
            for (double hour = -6; hour <= 30; hour += .5)
            {
                checkedAnswers++;
                if (!Whereabouts.SamePartAt(r, day, hour)) different++;
            }
            foreach (var segments in new[] { r.Sched.Day, r.Sched.Sunday })
            foreach (var segment in segments)
            foreach (double edge in new[] { segment.A, segment.B })
            foreach (double epsilon in new[] { -1e-6, 0, 1e-6 })
            {
                checkedAnswers++;
                if (!Whereabouts.SamePartAt(r, day, edge + epsilon)) different++;
            }
        }
        return new { checkedAnswers, different, ok = different == 0 };
    }
}

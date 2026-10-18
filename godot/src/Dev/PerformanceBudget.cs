namespace Scheldemist.Dev;

public static class PerformanceBudget
{
    // Wall time includes GPU/presentation waits; active main time does not. Do not conflate these metrics.
    // JobTest times complete wall frames in the full native Forward+ town (mirrors included).
    // Use the native checks' 120 Hz target, rather than the old baked-town 200 Hz wall limit.
    // The separate active-main-frame gate remains 5 ms; contaminated runs cannot establish a regression.
    public const int CheckFrameRate=120;
    public const double JobWallMeanMs=1000.0/CheckFrameRate;
    public const double ActiveMeanMs=5, ActiveP95Ms=5, TargetMeanMs=3, MaximumFrameMs=16;
}

namespace Scheldemist.Native.Services;

/// <summary>World metres; the original rig and its clips remain in their authored 5.4 m space.</summary>
public static class AntigoonSize
{
    public const float Height = 3.85f;
    public const float AuthoredHeight = 5.4f;
    public const float Scale = Height / AuthoredHeight;
    public const float BodyHeight = 5.2f * Scale;
    public const float BodyRadius = .62f * Scale;
    public const float ClearanceHeight = Height + .05f;
    public const float ClearanceRadius = .65f * Scale;
    public const float Step = 1.1f * Scale;
    public const float Leap = 2.3f * Scale;
    public const float ThrowHeight = 4.1f * Scale;
    public const float ShakeReach = 14 * Scale;
}

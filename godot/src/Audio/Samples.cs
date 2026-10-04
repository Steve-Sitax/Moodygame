using System.Collections.Generic;

namespace Scheldemist.Audio;

/// <summary>
/// The recorded sounds (audio/samples.ts). All CC0 or alike; source pages and licences in assets/ATTRIBUTION.md.
/// Each file is mono OGG, trimmed and normalised; "-loop" files have a crossfaded seam and loop cleanly.
/// Paths are under AudioPaths.Audio.
/// </summary>
public static class Samples
{
    private const string B = "bigsoundbank/", F = "freesound/";

    public static readonly Dictionary<string, string> Files = new()
    {
        // the cathedral
        ["hourStroke"] = B + "bell-hour-stroke-0994.ogg",
        ["carillon"] = F + "carillon-brussels-274987.ogg",
        // quays and ships
        ["shipBell"] = F + "ship-bell-353233.ogg",
        ["shipCreak"] = F + "ship-creak-483355-loop.ogg",
        ["pulleyCreak"] = F + "pulley-creak-438350.ogg",
        ["waterWall"] = F + "water-wall-851906-loop.ogg",
        ["waterPontoon"] = B + "water-pontoon-1444-loop.ogg",
        ["waterBridge"] = F + "water-boardwalk-758858-loop.ogg",
        ["ratchet"] = B + "ratchet-large-0795.ogg",
        ["winch"] = B + "winch-manual-0901.ogg",
        ["chain"] = F + "chain-pulley-386174.ogg",
        ["steamWhistleFar"] = F + "steam-whistle-far-9923.ogg",
        ["steamboatWhistle"] = F + "steamboat-whistle-840325.ogg",
        ["windMasts"] = B + "wind-masts-2443-loop.ogg",
        // ships passing on the Scheldt
        ["shipEngine"] = F + "ship-engine-587171-loop.ogg",
        ["paddleWheels"] = F + "paddle-steamer-481793-loop.ogg",
        ["tugToots"] = F + "steamboat-toots-840326.ogg",
        ["heaveShout"] = F + "heave-shout-47891.ogg",
        ["handbell"] = B + "handbell-2113.ogg",
        // streets
        ["hooves"] = F + "horse-walk-437103-loop.ogg",
        ["wheels"] = F + "cart-wheels-437077-loop.ogg",
        ["carriageFar"] = F + "horse-carriage-far-479797.ogg",
        ["carriageArch"] = F + "horse-arches-bruges-53488.ogg",
        ["anvil"] = B + "anvil-3589-loop.ogg",
        ["pump"] = F + "pump-815126.ogg",
        ["dogFar"] = F + "dog-far-440865.ogg",
        // people
        ["murmur"] = B + "walla-0684-loop.ogg",
        ["market"] = F + "market-venice-266691-loop.ogg",
        ["tavernCrowd"] = F + "tavern-crowd-438379-loop.ogg",
        ["tavernSong"] = F + "tavern-song-410739-loop.ogg",
        // rain
        ["rainRoofs"] = F + "rain-roofs-669487-loop.ogg",
        ["rainCobbles"] = B + "rain-puddle-1290-loop.ogg",
        // boots in puddles
        ["puddleWalk"] = F + "puddle-walk-106395.ogg",
        ["puddleSteps"] = F + "puddle-steps-531566.ogg",
        // the great storm (STORM_SAMPLES)
        ["galeTrees"] = B + "gale-trees-1450-loop.ogg",
        ["rainHeavy"] = B + "rain-heavy-1019-loop.ogg",
        ["windInside"] = B + "wind-inside-1714-loop.ogg",
        // the gulls (soundscape.ts loadGulls)
        ["gulls"] = B + "gulls-harbor-2573-mono.ogg",
    };

    /// <summary>The thunderclaps, sorted by how they sound: `near` rise fast and carry some highs; `far` are low rolls.</summary>
    public static readonly string[] ThunderNear = { "3115", "3116", "3114", "3180" };
    public static readonly string[] ThunderFar = { "2718", "3113", "3179", "3181", "3182", "3183", "3184" };
    public static string ThunderFile(string id) => $"{B}thunder-{id}.ogg";

    /// <summary>One-shot job sounds (soundscape.ts loadFx), and the footsteps (loadSteps).</summary>
    public static readonly Dictionary<string, string[]> Fx = new()
    {
        ["thud_wood"] = new[] { "kenney-impact/impactWood_heavy_000.ogg", "kenney-impact/impactWood_heavy_001.ogg", "kenney-impact/impactWood_heavy_002.ogg" },
        ["thud_soft"] = new[] { "kenney-impact/impactSoft_heavy_000.ogg", "kenney-impact/impactSoft_heavy_001.ogg", "kenney-impact/impactSoft_heavy_002.ogg" },
        ["thud_plank"] = new[] { "kenney-impact/impactPlank_medium_000.ogg", "kenney-impact/impactPlank_medium_001.ogg", "kenney-impact/impactPlank_medium_002.ogg" },
        ["splash"] = new[] { B + "splash-big-1519.ogg" },
        ["bell"] = new[] { B + "bell-5-oclock-3445.ogg" },
    };
    public static string StepFile(string surface, int n) => $"kenney-impact/footstep_{(surface == "wood" ? "wood" : "concrete")}_00{n}.ogg";

    /// <summary>Parts of the gull recording (seconds) with clean calls and no boat noise.</summary>
    public static readonly double[][] GullSpans = { new[] { 0.0, 42 }, new[] { 106.0, 114 } };
    /// <summary>Spans (s) of the dog recording with one to three clean barks each.</summary>
    public static readonly double[][] DogSpans = { new[] { 0, 2.8 }, new[] { 4.9, 7.4 }, new[] { 8.5, 10.4 }, new[] { 11.3, 13.7 }, new[] { 15.5, 17.9 } };
    /// <summary>One boot in a puddle each: recording, start s, length s, gain to an even level.</summary>
    public static readonly (string name, double start, double dur, double level)[] PuddleSpans =
    {
        ("puddleWalk", 1.28, 0.34, 1.04), ("puddleWalk", 1.84, 0.3, 3.0), ("puddleWalk", 2.32, 0.5, 2.43), ("puddleWalk", 2.92, 0.38, 0.66),
        ("puddleWalk", 3.86, 0.3, 2.81), ("puddleWalk", 4.16, 0.44, 2.17), ("puddleWalk", 4.76, 0.34, 2.38), ("puddleWalk", 5.84, 0.3, 1.95),
        ("puddleWalk", 6.32, 0.3, 2.09), ("puddleSteps", 2.64, 0.4, 1.05), ("puddleSteps", 3.64, 0.36, 1.2), ("puddleSteps", 5.0, 0.32, 2.41),
        ("puddleSteps", 5.4, 0.38, 1.06), ("puddleSteps", 6.2, 0.42, 0.99), ("puddleSteps", 7.06, 0.5, 0.3), ("puddleSteps", 8.0, 0.34, 0.63),
        ("puddleSteps", 9.26, 0.36, 1.05),
    };
    /// <summary>Carillon: the short phrase for the half hour (the whole tune is the voorslag before the hour).</summary>
    public const double CarillonShort = 10.5;
    /// <summary>Spans (s) of the tug recording: one toot each.</summary>
    public static readonly double[][] TootSpans = { new[] { 0, 0.42 }, new[] { 0.46, 1.08 } };
}

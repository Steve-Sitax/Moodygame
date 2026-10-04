// Stop posts from shared/omnibusLines.ts. One entry per physical post.
namespace Scheldemist.Play;

public static class RideStops
{
    public static readonly (string Id, float X, float Z)[] All =
    {
        ("werf", -270f, 10.4f),
        ("steenplein", -180f, 10.4f),
        ("vismarkt", -112f, 10.4f),
        ("rijnkaai", 30f, 10.4f),
        ("bassin", 78.3f, 31f),
        ("rijnkaai_back", 0f, 39.3f),
        ("vismarkt", -98.3f, 31f),
        ("vleeshuis", -118f, 111.6f),
        ("grote_markt", -252f, 67.6f),
        ("sint_jorispoort", -335.9f, 152.3f),
        ("stadspark", -307.4f, 228f),
        ("cathedral", -248f, 132.3f),
        ("meir", -141.6f, 198f),
        ("brouwersvliet", -87f, 176f),
        ("sint_jacob", -147.3f, 293.1f),
        ("kipdorppoort", -147.3f, 326.1f),
        ("ramparts", -90.2f, 349.7f),
        ("keizerspoort", 64.3f, 329.9f),
        ("sint_paulus", 49.9f, 261.9f),
        ("keizerstraat", -42.1f, 178.4f),
        ("conscienceplein", -123.2f, 158.6f),
    };
}

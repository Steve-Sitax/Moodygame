using Godot;
namespace Scheldemist.People;
public partial class Animals
{
    // market.ts FIELDS.litter: the four fish scraps and two fish boxes on the Vismarkt.
    /// <summary>Fish scraps by the market (strays nose for them; the giant eats there too).</summary>
    public static System.Collections.Generic.IReadOnlyList<Vector2> Scraps => MarketScraps;
    private static readonly Vector2[] MarketScraps = { new(-118.5f,21.5f),new(-114.2f,33.8f),new(-129.4f,26.2f),new(-103.6f,35),new(-138.9f,17.2f),new(-138.6f,30.4f) };
}

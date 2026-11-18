using Godot;

namespace Scheldemist.People;

public static class RuienRatSites
{
    public sealed record Site(string Id, string Area, string Entrance, Vector3 A, Vector3 B);

    // Foot positions from the installed ledge meshes. Each strip has 42 cm of runout at both
    // ends for the tail and a dry, 22 cm wide footprint around the centreline.
    public static readonly Site[] All =
    {
        new("ruien-rat:vleeshuis", "o2", "Cellar door beside Vleeshuis",
            new(-158.600f, -3.597f, 123.050f), new(-158.600f, -3.586f, 125.750f)),
        new("ruien-rat:rode-poort", "network_l16", "Rampart door on the Rode Poort rui",
            new(224.774f, -3.886f, 210.753f), new(224.690f, -3.886f, 212.200f)),
        new("ruien-rat:entrepot", "network_l18", "Rampart door by the Entrepot",
            new(206.859f, -3.589f, 26.678f), new(206.827f, -3.589f, 23.978f)),
        new("ruien-rat:suikerrui", "network_l28", "Stair-house on the Steenplein",
            new(-202.175f, -3.595f, 46.346f), new(-202.025f, -3.585f, 43.150f)),
        new("ruien-rat:lijnwaadrui", "network_l42", "Stair-house on the Lijnwaadmarkt",
            new(-214.155f, -3.586f, 166.851f), new(-214.050f, -3.586f, 164.453f)),
    };
}

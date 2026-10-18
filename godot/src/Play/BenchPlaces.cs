using System.Collections.Generic;
using Godot;

namespace Scheldemist.Play;

/// <summary>
/// Where each street bench stands and how it is turned (#165): the town fills it as it loads (the old baked benches'
/// new models and the authored benches), Day reads it to seat Jef and to list benches the engine also knows.
/// The id is the engine's sleep-bench id (rond:0, stop:werf:kaaien, or an authored object's id).
/// </summary>
public static class BenchPlaces
{
    public sealed record Place(string Id, string Model, Transform3D At, bool Fine, string Label)
    {
        public float SeatY => At.Origin.Y + (Model.Contains("park") ? .448f : .455f);
        /// <summary>The two sitting places on the seat (world), and the way a sitter faces.</summary>
        public Vector3 Sit(int k) => At * new Vector3(k == 0 ? -.45f : .45f, Model.Contains("park") ? .448f : .455f, .02f);
        public float Facing => At.Basis.GetEuler().Y;
    }

    private static readonly Dictionary<string, Place> places = new();
    public static IReadOnlyCollection<Place> All => places.Values;
    public static void Set(Place p) => places[p.Id] = p;
    public static Place? Get(string id) => places.TryGetValue(id, out var p) ? p : null;
    public static void Clear() => places.Clear();
}

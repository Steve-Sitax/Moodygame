namespace Scheldemist.Game;

public partial class Actors
{
    /// <summary>The seat the server gave this townsperson's event replica (0 = nobody), for the two-game check.</summary>
    public int ReplicaOwnerOf(string id) => replicas.TryGetValue(id, out var r) ? r.Owner : 0;
    /// <summary>Ask the server for a townsperson this game does not drive (the two-game contention check).</summary>
    public void TestClaim(string id) => Scheldemist.Net.Mp.Together.I?.SendText(new { type = "claim", ids = new[] { id } });
}

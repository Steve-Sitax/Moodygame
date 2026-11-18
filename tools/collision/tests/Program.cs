using System.Reflection;
using Godot;
using Scheldemist.World;

// Managed geometry only; does not start Godot, build the game or touch a save/cache.
var type = typeof(CollisionProxy);
var gridType = type.GetNestedType("Grid", BindingFlags.NonPublic)!;
var coverage = type.GetMethod("Covered", BindingFlags.Static | BindingFlags.NonPublic)!;
int checks = 0;
bool Covered(Vector3[] target, Vector3[] query, float reach = .025f, int budget = 8192)
{
    var grid = Activator.CreateInstance(gridType, new object[] { target, Enumerable.Range(0, target.Length).ToArray(), .125f, reach })!;
    return (bool)coverage.Invoke(null, new object[] { query[0], query[1], query[2], grid, reach, budget })!;
}
void Check(bool ok, string label) { if (!ok) throw new Exception(label); checks++; }
Vector3 P(float x, float z, float y = 0) => new(x, y, z);
Vector3[] triangle = { P(0, 0), P(10, 0), P(0, 10) };
Vector3[] slit = { P(0, 0), P(.23f, 0), P(.23f, 9.77f), P(0, 0), P(.23f, 9.77f), P(0, 10), P(.29f, 0), P(10, 0), P(.29f, 9.71f) };
Check(!Covered(slit, triangle), "Large triangle must not bridge the six-centimetre opening between old samples");
Check(!Covered(slit, triangle, .02f, 24), "Reverse coverage must restore an original triangle spanning an uncovered opening");
Check(Covered(triangle, triangle), "Large exact planar triangle remains covered without exhaustive sampling");
Check(Covered(triangle, triangle.Select(p => p + Vector3.Up * .015f).ToArray()), "Parallel face within tolerance");
Check(!Covered(triangle, triangle.Select(p => p + Vector3.Up * .03f).ToArray()), "Parallel face beyond tolerance");
Check(!Covered(Array.Empty<Vector3>(), triangle), "Empty proxy must restore the original");
Vector3[] tiled = { P(0, 0), P(.1f, 0), P(0, .1f), P(.1f, 0), P(.1f, .1f), P(0, .1f) };
Vector3[] acrossSeam = { P(.01f, .01f), P(.09f, .01f), P(.09f, .09f) };
Check(Covered(tiled, acrossSeam), "Joined coplanar triangles cover a face crossing their seam");
Check(!Covered(tiled, acrossSeam, .025f, 1), "Insufficient subdivision budget fails closed");
Console.WriteLine($"PASS: {checks} collision coverage regressions");

namespace Scheldemist
{
    public sealed class Main { public static Main? I => null; public bool Flag(string _) => false; }
}

using System;
using Godot;
using Scheldemist.Net;
using Scheldemist.Talks;

namespace Scheldemist.Play;

/// <summary>client/src/game/press.ts counterActions: F at either clerk. The papers keep their existing owner.</summary>
[GamePart(340)]
public partial class PressWorld : Node
{
    private Interact.Entry? berg, post, counter;
    private double wait;
    public override void _Ready()
    {
        berg = Interact.I.Add(Vector3.Zero, 3.2f, () => Clerk(Press.I?.Info?.Berg?.Clerk) ? "the Berg's counter: pawn or redeem" : null, () => _ = Press.I!.OpenBerg(), Key.F);
        post = Interact.I.Add(Vector3.Zero, 3.2f, () => Clerk(Press.I?.Info?.Post?.Clerk) ? "the post office counter" : null, () => _ = Press.I!.OpenPost(), Key.F);
        counter = Interact.I.Add(Vector3.Zero, 3.2f, () => Press.I?.Info?.Post?.At != null ? "the post office counter" : null, () => _ = Press.I!.OpenPost());
    }
    private static bool Clerk(string? id) => id is { Length: > 0 } && Folk.At(id) != null;
    public override void _Process(double delta)
    {
        if ((wait -= delta) > 0) return;
        wait = 0.25;
        if (Press.I?.Info is not { } info) return;
        if (berg != null && Folk.At(info.Berg?.Clerk ?? "") is { } b) berg.Place = b + Vector3.Up * 1.3f;
        if (post != null && Folk.At(info.Post?.Clerk ?? "") is { } p) post.Place = p + Vector3.Up * 1.3f;
        if (counter != null && info.Post?.At is { } at) counter.Place = new Vector3((float)at.X, 1.2f, (float)at.Z);
    }
    public override void _ExitTree() { berg?.Dispose(); post?.Dispose(); counter?.Dispose(); }
}

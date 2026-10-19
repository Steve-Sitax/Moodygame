using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Models;
using Scheldemist.Movers;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Native.World;

public static partial class NativeWashingProof
{
    private const float AttachmentTolerance = .00025f; // metres / basis components; packed MultiMesh float precision
    private sealed record RowCloth(MultiMeshInstance3D Source, MultiMeshInstance3D Cloth, Transform3D Attachment);
    private static float Difference(Transform3D a, Transform3D b) => Math.Max(a.Origin.DistanceTo(b.Origin),
        Math.Max(a.Basis.X.DistanceTo(b.Basis.X), Math.Max(a.Basis.Y.DistanceTo(b.Basis.Y), a.Basis.Z.DistanceTo(b.Basis.Z))));
    private static MeshInstance3D[] Pieces(Node root) => BakedWorld.All(root).OfType<MeshInstance3D>()
        .Where(n => n.HasMeta("native_boat_washing_pieces")).ToArray();
    private static RowCloth[] RowClothes(Node root) => BakedWorld.All(root).OfType<MultiMeshInstance3D>()
        .Where(n => n.HasMeta("native_boat_washing_pieces")).Select(n =>
        {
            var source = n.GetParent<MultiMeshInstance3D>();
            int live = Enumerable.Range(0, source.Multimesh.InstanceCount)
                .First(i => MathF.Abs(source.Multimesh.GetInstanceTransform(i).Basis.Determinant()) > 1e-8f);
            return new RowCloth(source, n, source.Multimesh.GetInstanceTransform(live).AffineInverse() * n.Multimesh.GetInstanceTransform(live));
        }).ToArray();

    // This opt-in proof observes real motion after drawing, rather than advancing Boats or its follower by hand.
    // Only the separate count/zero-scale fixture writes source transforms. Production rows/templates stay intact.
    private static async Task RunMotion(NativeTownGame game, string output, Action<bool, string> check, List<object> facts)
    {
        async Task Draw() => await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
        async Task SetState(int hour, string weather)
        {
            GameState.I.Apply(await ServerLink.I!.Api!.Post<JobsPayload>("api/dev/set", new { day = 1, hour, minute = 0, weather }));
            Daylight.I.Settle();
            for (int i = 0; i < 45; i++) await Draw();
        }
        void Aim(Transform3D frame, float side, bool low)
        {
            Vector3 at = frame.Origin - Vector3.Up * .3f;
            Vector3 normal = frame.Basis.Z.Normalized();
            var eye = at + normal * (side * (low ? 2.8f : 2.3f)) + Vector3.Up * (low ? -1.1f : .2f);
            game.Cam.GlobalPosition = eye;
            var q = new Transform3D(Basis.Identity, eye).LookingAt(at).Basis.GetRotationQuaternion();
            if (game.Cam is FlyCam fly) fly.Face(q); else game.Cam.Quaternion = q;
        }
        async Task Shot(string name, Func<Transform3D> frame, float side, bool low = false)
        {
            for (int i = 0; i < 30; i++) { Aim(frame(), side, low); await Draw(); }
            using var image = game.GetViewport().GetTexture().GetImage();
            if (image.SavePng(Path.Combine(output, name + ".png")) != Error.Ok) throw new IOException("Cannot save " + name);
        }
        var rows = RowClothes(game.World);
        check(rows.Length > 0, "motion: existing MultiMesh garments are available");
        if (rows.Length == 0) return;
        var focus = rows.First(r => r.Source.IsVisibleInTree());
        int focusIndex = Enumerable.Range(0, focus.Source.Multimesh.InstanceCount)
            .First(i => MathF.Abs(focus.Source.Multimesh.GetInstanceTransform(i).Basis.Determinant()) > 1e-8f);
        Transform3D RowFrame() => focus.Cloth.GlobalTransform * focus.Cloth.Multimesh.GetInstanceTransform(focusIndex);
        var proofParent = new Node3D { Name = "washing_motion_proof" };
        game.World.AddChild(proofParent);
        var spawned = new List<Boats.Float>();
        var dress = Boats.DressWashing ?? throw new InvalidOperationException("Missing production DressWashing callback");
        try
        {
            foreach (var (state, hour, weather, visible) in new[] { ("day", 13, "clear", true), ("rain", 13, "rain", false), ("night", 22, "clear", false), ("restored", 13, "clear", true) })
            {
                await SetState(hour, weather);
                if (state != "restored")
                {
                    bool loaded = Boats.I.Library.Contains("rhine_barge"); int calls = 0, dressed = 0;
                    Boats.Float? boat;
                    try
                    {
                        Boats.DressWashing = root => { calls++; dress(root); dressed += Pieces(root).Length; };
                        boat = Boats.I.Place("rhine_barge", proofParent);
                    }
                    finally { Boats.DressWashing = dress; }
                    facts.Add(new { name = "library-hook-" + state, alreadyLoaded = loaded, callbackCalls = calls, callbackPieces = dressed,
                        coverage = calls > 0 ? "FromLibrary invoked existing DressWashing" : "already loaded; no new hook invocation claimed" });
                    check(boat != null && Boats.I.Library.Contains("rhine_barge"), "motion: Place creates a library barge: " + state);
                    check(loaded ? calls == 0 : calls == 1 && dressed == 6, "motion: Place hook matches observed library state: " + state);
                    if (boat == null) throw new InvalidOperationException("Place returned null");
                    // The far-river sheet is south of z=-80; keep every fixture clear of the park/shore at low tide.
                    boat.Outer.Position = new Vector3(-450, 0, -150 - spawned.Count * 60);
                    spawned.Add(boat);
                    var pieces = Pieces(boat.Inner);
                    check(pieces.Length == 6 && pieces.Select(p => p.GetMeta("native_boat_washing_kind").AsString()).Distinct().Count() == 6,
                        "motion: new barge has six distinct garments: " + state);
                    check(pieces.Length == 6 && pieces.All(p => p.Visible == visible), "motion: new barge visibility at creation: " + state);
                    check(pieces.All(SharedGarmentAndPegs), "motion: original garment and peg geometry at attachments: " + state);
                    check(!BakedWorld.All(boat.Inner).Where(n => ModelLibrary.IsAside(n.Name.ToString()))
                        .Any(n => BakedWorld.All(n).Any(c => c.HasMeta("native_washing"))), "motion: helper models have no extra washing: " + state);
                }
                // Let the engine process the newly placed vessel before recording its initial live frame.
                await Draw();
                var start = rows.Select(r => Enumerable.Range(0, r.Source.Multimesh.InstanceCount).Select(r.Source.Multimesh.GetInstanceTransform).ToArray()).ToArray();
                var last = start.Select(a => a.ToArray()).ToArray();
                var boatsAtStart = spawned.Select(b => b.Inner.GlobalTransform).ToArray();
                var attachments = spawned.SelectMany(b => Pieces(b.Inner).Select(p => (Boat: b, Cloth: p, At: b.Inner.GlobalTransform.AffineInverse() * p.GlobalTransform))).ToArray();
                float rowError = 0, boatError = 0, movement = 0; var boatMovement = new float[spawned.Count];
                int countErrors = 0, zeroSamples = 0, movingFrames = 0, samples = 0;
                for (int frame = 0; frame < 120; frame++)
                {
                    Aim(RowFrame(), 1, false); await Draw(); bool moved = false;
                    for (int r = 0; r < rows.Length; r++)
                    {
                        var item = rows[r]; var source = item.Source.Multimesh; var cloth = item.Cloth.Multimesh;
                        if (cloth.InstanceCount != source.InstanceCount || cloth.VisibleInstanceCount != source.VisibleInstanceCount) countErrors++;
                        for (int i = 0; i < source.InstanceCount; i++)
                        {
                            var actual = source.GetInstanceTransform(i); samples++;
                            if (MathF.Abs(actual.Basis.Determinant()) < 1e-8f) zeroSamples++;
                            else { movement = Math.Max(movement, Difference(actual, start[r][i])); moved |= Difference(actual, last[r][i]) > .000001f; }
                            last[r][i] = actual;
                            if (i < cloth.InstanceCount) rowError = Math.Max(rowError, Difference(actual * item.Attachment, cloth.GetInstanceTransform(i)));
                        }
                    }
                    if (moved) movingFrames++;
                    for (int b = 0; b < spawned.Count; b++) boatMovement[b] = Math.Max(boatMovement[b], Difference(boatsAtStart[b], spawned[b].Inner.GlobalTransform));
                    foreach (var a in attachments) boatError = Math.Max(boatError, Difference(a.Boat.Inner.GlobalTransform * a.At, a.Cloth.GlobalTransform));
                }
                facts.Add(new { name = "motion-" + state, postDrawFrames = 120, rowGroups = rows.Length, samples, movingFrames, maxSourceMovement = movement,
                    maxRowAttachmentError = rowError, countErrors, zeroSamples, maxSpawnAttachmentError = boatError, spawnMovement = boatMovement, tolerance = AttachmentTolerance });
                check(rowError <= AttachmentTolerance && countErrors == 0, "motion: every row child follows current source after draw: " + state);
                check(movement > .001f && movingFrames > 1, "motion: source rows actually move: " + state);
                check(boatError <= AttachmentTolerance && boatMovement.All(m => m > .001f), "motion: all spawned barges move with attached garments and pegs: " + state);
                check(spawned.SelectMany(b => Pieces(b.Inner)).All(p => p.Visible == visible), "motion: all new barges follow weather and restore: " + state);
                await Shot("moving-row-front-" + state, RowFrame, 1);
                await Shot("moving-row-back-" + state, RowFrame, -1);
                await Shot("moving-row-low-" + state, RowFrame, 1, true);
                var newest = Pieces(spawned.Last().Inner).First();
                await Shot("spawn-front-" + state, () => newest.GlobalTransform, 1);
                await Shot("spawn-back-" + state, () => newest.GlobalTransform, -1);
                await Shot("spawn-low-" + state, () => newest.GlobalTransform, 1, true);
            }
            await CheckRowEdges(proofParent, Draw, dress, check, facts);
        }
        finally
        {
            Boats.DressWashing = dress;
            proofParent.QueueFree(); await Draw(); await Draw();
        }
        check(spawned.All(b => !Boats.I.Floats.Contains(b)), "motion: disposable barges leave the live float registry");
        // The sound cache registers live boats independently; releasing a proof vessel must retire it there too.
        Scheldemist.Audio.MovingSounds.I.Gather(0);
        check(true, "motion: moving sounds can gather after disposable barges are freed");
    }

    private static Vector3[] SurfaceFaces(Mesh mesh, int surface)
    {
        var a = mesh.SurfaceGetArrays(surface); var v = a[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        return a[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? v : a[(int)Mesh.ArrayType.Index].AsInt32Array().Select(i => v[i]).ToArray();
    }
    private static bool SharedGarmentAndPegs(MeshInstance3D piece)
    {
        var pack = ModelLibrary.Get("laundry", new ModelLibrary.Look(TwoSided: true, VertexColor: true))!;
        string kind = piece.GetMeta("native_boat_washing_kind").AsString();
        var original = ((MeshInstance3D)pack.Roots[kind]).Mesh.GetFaces();
        var peg = ((MeshInstance3D)pack.Roots["peg"]).Mesh.GetFaces();
        var cloth = new List<Vector3>(); var wood = new List<Vector3>();
        for (int s = 0; s < piece.Mesh.GetSurfaceCount(); s++)
            (piece.Mesh.SurfaceGetMaterial(s).ResourceName == "laundry_wood" ? wood : cloth).AddRange(SurfaceFaces(piece.Mesh, s));
        float scale = piece.Transform.Basis.Scale.X;
        var expectedPegs = NativeStreetFurniture.PegPositions(kind).SelectMany(u => peg.Select(v => v / scale + new Vector3(u, 0, 0))).ToArray();
        return original.Length == cloth.Count && expectedPegs.Length > 0 && expectedPegs.Length == wood.Count
            && original.Zip(cloth).All(p => p.First.DistanceTo(p.Second) < .0001f)
            && expectedPegs.Zip(wood).All(p => p.First.DistanceTo(p.Second) < .0001f);
    }

    private static async Task CheckRowEdges(Node3D parent, Func<Task> draw, Action<Node3D> dress, Action<bool, string> check, List<object> facts)
    {
        var model = ModelLibrary.Get("boats", new ModelLibrary.Look(TwoSided: true, Affine: .6))!.Copy("rhine_barge")!;
        try
        {
            var raw = BakedWorld.All(model).OfType<MeshInstance3D>().First(n => n.Mesh != null && Enumerable.Range(0, n.Mesh.GetSurfaceCount())
                .Any(s => n.Mesh.SurfaceGetMaterial(s)?.ResourceName is "washing" or "boats_thin"));
            var fixture = new Node3D { Name = "washing_count_fixture", Visible = false }; parent.AddChild(fixture);
            var source = new MultiMeshInstance3D { Multimesh = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, Mesh = raw.Mesh, InstanceCount = 3 } };
            fixture.AddChild(source);
            for (int i = 0; i < 3; i++) source.Multimesh.SetInstanceTransform(i, new Transform3D(Basis.Identity, new Vector3(i * 10, 0, 0)));
            dress(fixture); var children = RowClothes(fixture);
            check(children.Length == 6, "motion: disposable row uses the production six-piece dresser and follower");
            float error = 0; int countErrors = 0, zeroSamples = 0, samples = 0;
            foreach (int count in new[] { 0, 1, -1 })
                for (int frame = 0; frame < 4; frame++)
                {
                    // Resize exercises the follower's allocation branch; never change a production row.
                    source.Multimesh.InstanceCount = count == -1 ? 4 : 3;
                    source.Multimesh.VisibleInstanceCount = count;
                    for (int i = 0; i < source.Multimesh.InstanceCount; i++) source.Multimesh.SetInstanceTransform(i,
                        new Transform3D(i == 1 ? Basis.Identity.Scaled(Vector3.Zero) : new Basis(Vector3.Up, frame * .1f), new Vector3(i * 10, frame * .05f, 0)));
                    await draw();
                    foreach (var item in children)
                    {
                        var cloth = item.Cloth.Multimesh;
                        if (cloth.InstanceCount != source.Multimesh.InstanceCount || cloth.VisibleInstanceCount != count) countErrors++;
                        for (int i = 0; i < Math.Min(source.Multimesh.InstanceCount, cloth.InstanceCount); i++)
                        {
                            samples++; var t = source.Multimesh.GetInstanceTransform(i);
                            if (i == 1) zeroSamples++;
                            error = Math.Max(error, Difference(t * item.Attachment, cloth.GetInstanceTransform(i)));
                        }
                    }
                }
            check(children.Length == 6 && countErrors == 0 && error <= AttachmentTolerance && zeroSamples > 0,
                "motion: visible counts 0/1/all, resizing and zero-scale sources propagate after draw");
            facts.Add(new { name = "row-edge-fixture", frames = 12, samples, zeroSamples, countErrors, maxAttachmentError = error });
            fixture.QueueFree(); await draw();
        }
        finally { model.Free(); }
    }
}

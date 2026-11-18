using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.World.Ruien;

namespace Scheldemist.Audio;

public partial class Soundscape
{
    // The integrated native proof drives the normal mixer with a reproducible crowd, hour and
    // cart at the actual Grote Markt grate. Capture its filtered stereo channel in isolation.
    public async Task<List<(string name, bool ok, string detail)>> ProofRuienStreetSound()
    {
        var checks = new List<(string name, bool ok, string detail)>();
        void Check(string name, bool ok, string detail = "") => checks.Add((name, ok, detail));
        var market = live.FirstOrDefault(l => l.E.Name == "Grote Markt stalls")?.E;
        if (!Prepared || market == null || Ruien.I == null)
        { Check("market and mixer installed", false); return checks; }
        FindStreetGrates(Ruien.I.Data);
        var grate = streetGrates.MinBy(g => g.Mouth.DistanceSquaredTo(new((float)market.X, 0, (float)market.Z)));
        if (grate == null) { Check("Grote Markt has a physical vent", false); return checks; }
        var at = grate.Mouth;
        Check("Grote Markt has a physical vent", grate.Iron.Name.ToString().Contains("C1_crown_0") &&
            grate.Iron.GetChildren().OfType<MeshInstance3D>().Any(m => m.Mesh != null) &&
            new Vector2(at.X - (float)market.X, at.Z - (float)market.Z).Length() < 8, $"{grate.Iron.GetPath()} at {at}");

        var oldClock = clock; var oldPeople = people; var oldVehicles = vehicles.ToArray();
        var oldRoom = roomKind; var oldPos = listenerPos; bool oldAuto = Auto;
        bool wasProcessing = IsProcessing();
        var moving = MovingSounds.I; bool wasMoving = moving?.IsProcessing() == true;
        var ear = new AudioListener3D();
        using var capture = new AudioEffectCapture { BufferLength = 1 };
        int captureBus = -1, captureSlot = -1;
        SetProcess(false);
        moving?.SetProcess(false);
        try
        {
            Main.I.View.AddChild(ear);
            listenerPos = at + new Vector3(-2.4f, -2.1f, .6f);
            ear.GlobalPosition = listenerPos; ear.MakeCurrent();
            roomKind = "ruien"; Auto = true; clock = 10;
            StopGrate();
            vehicles.Clear();
            var crowd = Enumerable.Range(0, 10).Select(i => new Vector2((float)market.X + i % 3, (float)market.Z + i / 3)).ToArray();
            people = Array.Empty<Vector2>();
            RuienStreetSounds();
            Check("empty square is quiet", grateSpot == null);
            clock = 1; people = crowd; RuienStreetSounds();
            Check("closed market is quiet at night", grateSpot == null);
            vehicles.Add((new("dray", at.X, at.Z, "stop"), null)); RuienStreetSounds();
            Check("stopped cart is quiet", grateSpot == null);
            vehicles[0] = (new("handcart", at.X + 20, at.Z, "go"), null); RuienStreetSounds();
            Check("distant moving cart is quiet", grateSpot == null);
            vehicles[0] = (new("handcart", at.X + 1, at.Z, "go"), null); RuienStreetSounds();
            Check("passing cart drives the wheel recording", grateWheels?.P3?.Playing == true &&
                grateWheels.Stream == buf.GetValueOrDefault("wheels") && grateMarket == null);
            StopGrate(); vehicles.Clear(); clock = 10;
            RuienStreetSounds();
            Check("morning crowd drives a filtered point under the iron", grateMarket?.P3 is { Playing: true } player &&
                player.GlobalPosition.DistanceTo(at) < .03f && grateMarket.Stream == buf.GetValueOrDefault("market") &&
                grateSpot?.Chan is {} channel && AudioServer.GetBusSend(channel.Index) == "RoomAmbience" &&
                channel.Lp.CutoffHz is > 200 and <= 781 && AudioServer.IsBusEffectEnabled(channel.Index, 0),
                $"source {grateMarket?.P3?.GlobalPosition}, cutoff {grateSpot?.Chan?.Lp.CutoffHz} Hz");
            if (grateSpot?.Chan is {} ch && grateMarket is {} voice)
            {
                voice.Level = voice.LevelT; Volumes(grateSpot, voice, true);
                captureBus = ch.Index; captureSlot = AudioServer.GetBusEffectCount(ch.Index);
                AudioServer.AddBusEffect(ch.Index, capture);
                async Task<Vector2> Energy(float yaw)
                {
                    ear.Rotation = Vector3.Up * yaw;
                    // The native listener moves at the physics tick and the mixer runs independently.
                    await ToSignal(GetTree().CreateTimer(.18), SceneTreeTimer.SignalName.Timeout);
                    capture.ClearBuffer();
                    ulong end = Time.GetTicksMsec() + 1800;
                    while (capture.GetFramesAvailable() < 4096 && Time.GetTicksMsec() < end)
                        await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
                    int n = capture.GetFramesAvailable();
                    var sum = Vector2.Zero;
                    if (n > 0) foreach (var v in capture.GetBuffer(n)) sum += v * v;
                    return sum / Math.Max(1, n);
                }
                var right = await Energy(0); var left = await Energy(MathF.PI);
                Check("turning under the grate reverses the audible side", right.Y > right.X * 1.1f &&
                    left.X > left.Y * 1.1f && Math.Min(right.Y, left.X) > 1e-12f,
                    $"mean square L/R {right.X:G4}/{right.Y:G4}, turned {left.X:G4}/{left.Y:G4}");
            }
            if (captureBus >= 0) { AudioServer.RemoveBusEffect(captureBus, captureSlot); captureBus = -1; }
            listenerPos = at + Vector3.Right * (GrateReach + 1) + Vector3.Down * 2;
            RuienStreetSounds(); Check("deep in the hall the grate is silent", grateSpot == null);
            listenerPos = at + Vector3.Up * 1.7f;
            RuienStreetSounds(); Check("the underground feed is silent on the square", grateSpot == null);
        }
        finally
        {
            if (captureBus >= 0) AudioServer.RemoveBusEffect(captureBus, captureSlot);
            StopGrate(); ear.ClearCurrent(); ear.QueueFree();
            listenerPos = oldPos; roomKind = oldRoom; Auto = oldAuto; clock = oldClock; people = oldPeople;
            vehicles.Clear(); vehicles.AddRange(oldVehicles);
            moving?.SetProcess(wasMoving); SetProcess(wasProcessing);
        }
        return checks;
    }
}

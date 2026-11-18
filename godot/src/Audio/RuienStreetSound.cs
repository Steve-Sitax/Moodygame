using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.World.Ruien;
using static Scheldemist.Audio.Wa;

namespace Scheldemist.Audio;

public partial class Soundscape
{
    private const float GrateReach = 11;
    private sealed record StreetGrate(Vector3 Mouth, RuienData.Zone Zone, Node3D Iron);
    private readonly List<StreetGrate> streetGrates = new();
    private RuienData? grateLayout;
    private StreetGrate? soundingGrate;
    private Spot? grateSpot;
    private V? grateMarket, grateWheels;

    // Resolve the installed iron once, on the first underground visit. A retired opening,
    // light marker or entrance without a physical street grate cannot carry these sounds.
    private void FindStreetGrates(RuienData data)
    {
        if (grateLayout == data) return;
        grateLayout = data;
        streetGrates.Clear();
        foreach (var area in data.Areas)
        foreach (var way in area.Ways)
        {
            if (way.Kind != "grate" || way.Retired) continue;
            var iron = Main.I.View.GetNodeOrNull<Node3D>((way.Round ? "round_grate_" : "grate_") + way.Id);
            if (iron == null || iron.GlobalPosition.DistanceSquaredTo(way.Top) > .10f * .10f) continue;
            var top = new Vector2(way.Top.X, way.Top.Z);
            RuienData.Zone? host = null;
            float best = -.05f;
            foreach (var zone in area.Zones)
            {
                float inside = zone.Inside(top, out _);
                if (inside > best) { host = zone; best = inside; }
            }
            if (host != null) streetGrates.Add(new(iron.GlobalPosition + Vector3.Down * .16f, host, iron));
        }
    }

    private bool UnderGrate(StreetGrate grate, Vector3 ear)
    {
        if (roomKind != "ruien" || ear.Y >= grate.Mouth.Y - .25f ||
            ear.DistanceSquaredTo(grate.Mouth) >= GrateReach * GrateReach) return false;
        var p = new Vector2(ear.X, ear.Z);
        return grate.Zone.Inside(p, out _) >= 0 &&
            grate.Zone.Inside(p.Lerp(new(grate.Mouth.X, grate.Mouth.Z), .5f), out _) >= 0;
    }

    private void RuienStreetSounds()
    {
        if (!Auto || roomKind != "ruien" || Ruien.I is not {} ruien || ruien.CoverAt(listenerPos) <= .5f)
        { StopGrate(); return; }
        FindStreetGrates(ruien.Data);
        StreetGrate? nearest = null;
        float distance = GrateReach * GrateReach;
        foreach (var grate in streetGrates)
        {
            float d = listenerPos.DistanceSquaredTo(grate.Mouth);
            if (d < distance && UnderGrate(grate, listenerPos)) { nearest = grate; distance = d; }
        }
        if (nearest != soundingGrate) StopGrate();
        if (nearest == null) return;

        var at = nearest.Mouth;
        double market = 0, wheels = 0;
        foreach (var l in live)
        {
            if (l.E.Kind != "market") continue;
            double through = 1 - Ramp(Hyp(l.E.X - at.X, l.E.Z - at.Z), 4, 20);
            if (through > 0) market = Math.Max(market, through * (l.E.Gain ?? 1) * KindLevel("market") * Chatter(PeopleNear(l.E.X, l.E.Z, 25)));
        }
        foreach (var (cart, _) in vehicles)
        {
            if (cart.State != "go" || cart.Kind is not ("dray" or "handcart")) continue;
            double through = 1 - Ramp(Hyp(cart.X - at.X, cart.Z - at.Z), 1, 12);
            wheels = Math.Max(wheels, through * (1 - .3 * rain));
        }
        if (market <= 0 && wheels <= 0 && (grateMarket?.Level ?? 0) < .01 && (grateWheels?.Level ?? 0) < .01)
        { StopGrate(); return; }
        if (grateSpot == null)
        {
            // A free filtered channel is required. The iron and shaft cut the street's highs.
            if (freeChans.Count == 0) return;
            grateSpot = NewSpot(at.X, at.Y, at.Z, 2.2, 1.2, 25, 0, 780, "RoomAmbience", GrateReach, 0);
            grateSpot.Hold = true;
            soundingGrate = nearest;
        }
        GrateLayer(grateSpot, ref grateMarket, "market", .40, market);
        GrateLayer(grateSpot, ref grateWheels, "wheels", .43, wheels);
    }

    private void GrateLayer(Spot spot, ref V? voice, string sample, double gain, double level)
    {
        if (voice == null)
        {
            if (level <= 0 || !buf.TryGetValue(sample, out var recording)) return;
            // Begin at zero so a newly heard passing cart approaches smoothly.
            voice = Add(spot, recording, "grate " + sample, 0, from: Rnd() * Math.Max(0, recording.GetLength() - .1));
            voice.Gain = gain;
            voice.Level = 0;
        }
        voice.LevelT = level;
        voice.LevelTau = .20;
    }

    private void StopGrate()
    {
        if (grateSpot != null) DropSpot(grateSpot);
        grateSpot = null;
        soundingGrate = null;
        grateMarket = grateWheels = null;
    }
}

using System;
using System.Collections.Generic;
using System.Text.Json;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// The gulls' own check (-- --gulltest &lt;dir&gt;): by day on the Rijnkaai, no flying bird ever slows to a stop or jumps
/// (outside the take-off and the flare to land), they take off and land; one put up flies off; at night they all come
/// down and stay down; the part's own frame cost and allocations. Writes gulltest.json, then quits (1 if a check failed).
/// </summary>
public partial class Gulls
{
    private string testDir = "";
    private string testPhase = "";
    private float testT;
    private readonly Dictionary<string, object> testOut = new();
    private readonly List<string> testFails = new();
    private float minAirSpeed = float.MaxValue, maxStill, airSum;
    private int slowFrames, jumps, frames, takeoffs, landings, allocFrames, debugLines, ownFlightsAtNight;
    private long maxAlloc;
    private readonly float[] still = new float[NGull];
    private readonly Mode[] lastMode = new Mode[NGull];
    private Vector3? testThreat;
    private int flushBird = -1;
    private float settledAt = -1;
    private int airAfter, flightsAfter;
    private double costDay;

    private void TestStart()
    {
        testDir = Paths.TestOutput("gulltest");
        System.IO.Directory.CreateDirectory(testDir);
        testPhase = "wait";
    }

    private void TestStep(float dt)
    {
        if (testPhase == "") return;
        testT += dt;
        if (testThreat is { } tt) threatPrev = tt;
        switch (testPhase)
        {
            case "wait":
                if (testT < 3) return;
                Daylight.I!.SetTime(13);
                Daylight.I.SetWeather("clear");
                Daylight.I.Settle();
                Next("day");
                costSum = 0; costN = 0;
                return;
            case "day":
                Watch(dt, true);
                if (testT < 45) return;
                costDay = MeanMs;
                testOut["day"] = new { seconds = 45, airMean = Math.Round(airSum / Math.Max(1, frames), 1), minAirSpeed = Math.Round(minAirSpeed, 2), slowFrames, maxStillSeconds = Math.Round(maxStill, 2), jumps, takeoffs, landings, frames, places = PlaceCounts(), caller = Caller(Eye) is { } cl ? $"{cl.X:0},{cl.Y:0},{cl.Z:0}" : "none" };
                if (slowFrames > 0 || maxStill > 0) testFails.Add($"a flying gull slowed under 2 m/s on {slowFrames} frames (still for {maxStill:0.00} s)");
                if (jumps > 0) testFails.Add($"{jumps} jumps of a flying gull");
                if (takeoffs == 0 || landings == 0) testFails.Add($"by day {takeoffs} take-offs and {landings} landings in 45 s");
                // put one up: the nearest standing gull, walked at from 9 m
                float bd = float.MaxValue;
                for (int i = 0; i < NGull; i++)
                    if (birds[i].M == Mode.Sit && birds[i].Pos.DistanceTo(Eye) < bd) { bd = birds[i].Pos.DistanceTo(Eye); flushBird = i; }
                Next("flush");
                return;
            case "flush":
            {
                if (flushBird < 0) { testFails.Add("no standing gull to put up"); Next("night0"); return; }
                var b = birds[flushBird];
                if (testT < 3)
                {
                    if (b.M == Mode.Sit) testThreat = b.Pos + new Vector3(9 - testT * 3.2f, 0, 0);
                    return;
                }
                if (testT < 6) return;
                float away = testThreat is { } th ? b.Pos.DistanceTo(th) : 0;
                testOut["flush"] = new { bird = flushBird, mode = b.M.ToString(), metresAway = Math.Round(away, 1), height = Math.Round(b.Pos.Y, 1) };
                if (b.M is Mode.Sit || away < 6) testFails.Add($"the gull walked at stayed ({b.M}, {away:0.0} m)");
                testThreat = null;
                Daylight.I!.SetTime(21.5f);
                Daylight.I.Settle();
                Next("night");
                return;
            }
            case "night":
            {
                Watch(dt, false);
                int air = 0;
                for (int i = 0; i < NGull; i++) if (birds[i].M is Mode.Wheel or Mode.Fly) air++;
                if (settledAt < 0 && air == 0) { settledAt = testT; takeoffs = 0; }
                if (settledAt >= 0) { airAfter = Math.Max(airAfter, air); flightsAfter = takeoffs; }
                if (testT < 80) return;
                testOut["night"] = new { night = Math.Round(Daylight.I!.Night, 2), allDownAfterSeconds = Math.Round(settledAt, 1), airAtEnd = air, mostInAirAfter = airAfter, flightsAfter, ownFlightsAtNight, places = PlaceCounts(), caller = Caller(Eye) != null ? "a call" : "none", minAirSpeed = Math.Round(minAirSpeed, 2), slowFrames, jumps };
                if (settledAt < 0 || settledAt > 60) testFails.Add($"at night the gulls were not all down in 60 s ({air} up at the end)");
                if (ownFlightsAtNight > 0) testFails.Add($"{ownFlightsAtNight} gulls went up at night on their own");
                if (slowFrames > 0 || jumps > 0) testFails.Add($"night: {slowFrames} slow frames, {jumps} jumps");
                testOut["cost"] = new { parts = CostParts, dayMeanMs = Math.Round(costDay, 4), allMeanMs = Math.Round(MeanMs, 4), maxAllocatedBytes = maxAlloc, framesAllocating = allocFrames, frames, trianglesGull = rigs[0].Triangles, trianglesPigeon = rigs[1].Triangles };
                if (allocFrames > frames / 50) testFails.Add($"{allocFrames} of {frames} frames allocated");
                testOut["failures"] = testFails;
                testOut["ok"] = testFails.Count == 0;
                System.IO.File.WriteAllText(System.IO.Path.Combine(testDir, "gulltest.json"), JsonSerializer.Serialize(testOut, new JsonSerializerOptions { WriteIndented = true }));
                GD.Print($"gulltest: {(testFails.Count == 0 ? "PASS" : "FAIL " + string.Join("; ", testFails))}");
                testPhase = "";
                GetTree().Quit(testFails.Count == 0 ? 0 : 1);
                return;
            }
        }
    }

    private void Next(string phase)
    {
        testPhase = phase;
        testT = 0;
        minAirSpeed = float.MaxValue; maxStill = 0; airSum = 0; slowFrames = 0; jumps = 0; frames = 0; takeoffs = 0; landings = 0;
        for (int i = 0; i < NGull; i++) { still[i] = 0; lastMode[i] = birds[i]?.M ?? Mode.Sit; }
    }

    /// <summary>Every flying gull this frame: fast enough, no jump; the take-offs and landings.</summary>
    private void Watch(float dt, bool day)
    {
        if (dt <= 0) return;
        frames++;
        if (AllocatedLastFrame > 0) { allocFrames++; maxAlloc = Math.Max(maxAlloc, AllocatedLastFrame); }
        int air = 0;
        for (int i = 0; i < NGull; i++)
        {
            var b = birds[i];
            bool up = b.M is Mode.Wheel or Mode.Fly;
            bool wasUp = lastMode[i] is Mode.Wheel or Mode.Fly;
            if (up && !wasUp) takeoffs++;
            if (!up && wasUp) landings++;
            lastMode[i] = b.M;
            if (!up) { still[i] = 0; continue; }
            air++;
            // (the take-off's first beats and the flare onto a place are slow on purpose)
            if (b.M == Mode.Fly && (b.Air < 0.7f || b.Flare > 0 || b.Delay > 0)) { still[i] = 0; continue; }
            float v = (b.Pos - b.Prev).Length() / dt;
            if ((v > 40 || v < 1.5f) && debugLines++ < 40) GD.Print($"gulltest {(v > 40 ? "jump" : "slow")} bird {i} {b.M} v {v:0.0} k {b.K:0.00} T {b.T:0.0} air {b.Air:0.0} goal {(b.Goal >= 0 ? spots[b.Goal].Kind : "-")} toWheel {b.ToWheel} cruise {b.Cruising} vel {b.Vel} boat {b.Boat != null} pos {b.Pos} prev {b.Prev} offK {b.OffK:0.00}");
            if (v > 40) jumps++;
            minAirSpeed = Math.Min(minAirSpeed, v);
            if (v < 1.5f) { slowFrames++; still[i] += dt; maxStill = Math.Max(maxStill, still[i]); }
            else still[i] = 0;
        }
        airSum += air;
    }

    private Dictionary<string, int> PlaceCounts()
    {
        var d = new Dictionary<string, int>();
        for (int i = 0; i < NGull; i++)
        {
            var b = birds[i];
            string k = b.M is Mode.Wheel ? (b.Boat != null ? "following a boat" : "wheeling") : b.M is Mode.Fly ? "flying" : b.Spot >= 0 ? spots[b.Spot].Kind.ToString() : b.M.ToString();
            d[k] = d.GetValueOrDefault(k) + 1;
        }
        return d;
    }
}

using System;
using System.Collections.Generic;

namespace Scheldemist.Net;

// client/net/api.ts and game/townlife.ts. These numbers are sent by the engine, never invented here.
public sealed record EventScene
{
    public string Kind { get; init; } = "";
    public string A { get; init; } = ""; public string B { get; init; } = "";
    public string? Agent { get; init; }
    public string? Wrong { get; init; }
    public bool? Caught { get; init; }
    public bool Resolved { get; init; }
    public EventPoint? Flee { get; init; }
    public Dictionary<string, string> Lines { get; init; } = new();
}
public sealed record EventPoint(double X, double Z);
public sealed record TempestView { public string Phase { get; init; } = ""; }
public sealed record EventGroup { public List<string> Ids { get; init; } = new(); public double X { get; init; } public double Z { get; init; } public bool Gone { get; init; } }
public sealed record FireView
{
    public string Owner { get; init; } = ""; public string OwnerName { get; init; } = "";
    public double[] Door { get; init; } = new double[2]; public double[] Out { get; init; } = new double[2]; public double[] Step { get; init; } = new double[2]; public double[] Water { get; init; } = new double[2];
    public int Storeys { get; init; }
    public List<double[]> Chain { get; init; } = new();
    public int Full { get; init; }
    public List<string> ChainIds { get; init; } = new();
    public double[] Station { get; init; } = new double[2];
    public List<double[]> PumpPath { get; init; } = new();
    public double[] PumpAt { get; init; } = new double[3];
    public List<string> Firemen { get; init; } = new();
    public ChainSeat? Jef { get; init; }
    public string? Settled { get; init; }
}
public sealed record ChainSeat { public int Slot { get; init; } public bool In { get; init; } }
public sealed record HiringView { public bool Called { get; init; } public List<HiringSpot> Spots { get; init; } = new(); }
public sealed record HiringSpot
{
    public string Id { get; init; } = ""; public string Label { get; init; } = "";
    public double X { get; init; } public double Z { get; init; } public double Yaw { get; init; }
    public string? Foreman { get; init; }
    public string Ship { get; init; } = "";
    public int Men { get; init; }
    public List<string> Picked { get; init; } = new();
    public bool Jef { get; init; }
    public HiringResult? JefResult { get; init; }
    public string? Call { get; init; }
    public List<string> Remarks { get; init; } = new();
    public string? ToJef { get; init; }
    public string? Source { get; init; }
}
public sealed record HiringResult { public bool Picked { get; init; } public string Text { get; init; } = ""; }
public sealed record DirectorReply { public bool Ok { get; init; } public int Id { get; init; } public string Title { get; init; } = ""; public string Why { get; init; } = ""; }
public sealed record ActionProposalReply { public string Line { get; init; } = ""; public int? ActionId { get; init; } public string? Refused { get; init; } }
public sealed record EventsReply { public List<TownEvent> Events { get; init; } = new(); public List<string> Closed { get; init; } = new(); }

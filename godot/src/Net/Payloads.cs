using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Scheldemist.Net;

// What the server sends and takes, as client/src/net/api.ts names it. The JSON names are the server's
// (money_c, employer_npc): Api.Json turns MoneyC into money_c by itself; a name that is not snake_case there
// carries its own [JsonPropertyName]. A job's task and the town are many kinds in one field: they stay JSON
// (JsonElement) until the part that plays them is ported and gives them their records.

public sealed record PlayerState
{
    public string Name { get; init; } = "";
    public int MoneyC { get; init; }
    public int Day { get; init; }
    public int Hour { get; init; }
    public double Food { get; init; }
    public double Warmth { get; init; }
    public double Health { get; init; }
    public double Sleep { get; init; }
}

public sealed record PocketItem
{
    public int Id { get; init; }
    public string Kind { get; init; } = "";
    public string Name { get; init; } = "";
    public int? JobId { get; init; }
    /// <summary>M6: the paper's day, the letter or the pawn ticket this pocket row is.</summary>
    public int? Ref { get; init; }
    public string? Use { get; init; }
    public string? Note { get; init; }
}

public sealed record Ware
{
    public string Kind { get; init; } = "";
    public string Name { get; init; } = "";
    public int PriceC { get; init; }
}

public sealed record GameClock
{
    public int Day { get; init; }
    public int Hour { get; init; }
    public int Minute { get; init; }
    public string Weekday { get; init; } = "";
    /// <summary>"fog", "mist", "clear", "rain" or "storm".</summary>
    public string Weather { get; init; } = "clear";
}

public sealed record Epilogue
{
    public string Title { get; init; } = "";
    public List<string> Paragraphs { get; init; } = new();
}

public sealed record Ending
{
    /// <summary>"week" or "health".</summary>
    public string Kind { get; init; } = "";
    public int Day { get; init; }
    public Epilogue? Epilogue { get; init; }
}

public sealed record Progress
{
    public int Delivered { get; init; }
    public int Lost { get; init; }
    public int Sold { get; init; }
}

public sealed record Job
{
    public int Id { get; init; }
    public string Title { get; init; } = "";
    public string EmployerNpc { get; init; } = "";
    public string EmployerName { get; init; } = "";
    public string TaskType { get; init; } = "";
    public int PayC { get; init; }
    public string Risk { get; init; } = "";
    public string Pitch { get; init; } = "";
    /// <summary>The work itself (carry, watch, deliver, letters, mill, lamps: api.ts Task), as the server sent it.</summary>
    public JsonElement? Task { get; init; }
    public string Source { get; init; } = "";
    /// <summary>"offered", "taken", "done" or "failed".</summary>
    public string Status { get; init; } = "";
    public bool Playable { get; init; }
    public string? OutcomeText { get; init; }
}

public sealed record BoardState
{
    /// <summary>"writing" or "ready".</summary>
    public string State { get; init; } = "ready";
    public string? Source { get; init; }
    public string? Error { get; init; }
}

public sealed record RentState
{
    public bool Paid { get; init; }
    public int PriceC { get; init; }
    public int Bedtime { get; init; }
}

public sealed record RideOn
{
    public string Line { get; init; } = "";
    public string From { get; init; } = "";
    public double Minutes { get; init; }
    public double Left { get; init; }
}

public sealed record RideChange
{
    public string FromLine { get; init; } = "";
}

public sealed record RideState
{
    public RideOn? On { get; init; }
    public int FareC { get; init; }
    public RideChange? Change { get; init; }
}

public sealed record FogTurn
{
    public double H { get; init; }
    public bool Fog { get; init; }
}

/// <summary>M7 fog lamps: today's fog as the lamplighters see it.</summary>
public sealed record LampsFog
{
    public int? Day { get; init; }
    public bool Start { get; init; }
    public List<FogTurn> Turns { get; init; } = new();
}

/// <summary>The lamps a player lights for a lamplighter tonight.</summary>
public sealed record LampsHelp
{
    public int Day { get; init; }
    public string Round { get; init; } = "";
    public int From { get; init; }
    public List<string> Lit { get; init; } = new();
    public double Open { get; init; }
    public double Until { get; init; }
    public int Job { get; init; }
}

/// <summary>The game state every call and the push channel carry (api.ts JobsPayload): the board, Jef, his pockets, the clock.</summary>
public record JobsPayload
{
    public BoardState Board { get; init; } = new();
    public List<Job> Jobs { get; init; } = new();
    public PlayerState Player { get; init; } = new();
    public List<PocketItem> Pockets { get; init; } = new();
    public GameClock Clock { get; init; } = new();
    public RentState Rent { get; init; } = new();
    public Ending? Ending { get; init; }
    public RideState? Ride { get; init; }
    public LampsFog? LampsFog { get; init; }
    public LampsHelp? LampsHelp { get; init; }
}

public sealed record Robbed
{
    public int MoneyC { get; init; }
    public List<string> Things { get; init; } = new();
}

public sealed record WakeTime
{
    public int Day { get; init; }
    public int Hour { get; init; }
    public int Minute { get; init; }
    public string Weekday { get; init; } = "";
}

public sealed record HourMinute
{
    public int Hour { get; init; }
    public int Minute { get; init; }
}

public sealed record Night
{
    /// <summary>"bed", "rough" or "home".</summary>
    public string Where { get; init; } = "";
    public string? Place { get; init; }
    public string? Home { get; init; }
    [JsonPropertyName("turnedAway")] public bool TurnedAway { get; init; }
    public List<string> Summary { get; init; } = new();
    public int Day { get; init; }
    public Ending? Ended { get; init; }
    public double? SleptMin { get; init; }
    public WakeTime? Wake { get; init; }
    public bool? Turned { get; init; }
    public bool? Collapsed { get; init; }
    public Robbed? Robbed { get; init; }
}

public sealed record SpotYaw
{
    public double X { get; init; }
    public double Z { get; init; }
    public double Yaw { get; init; }
}

/// <summary>M7 sleep: asleep now, how far.</summary>
public sealed record RestView
{
    /// <summary>"home", "doss", "bench" or "cell".</summary>
    public string Place { get; init; } = "";
    public string Label { get; init; } = "";
    public string? Bench { get; init; }
    public string? Home { get; init; }
    public double PlannedMin { get; init; }
    public double SleptMin { get; init; }
    public HourMinute From { get; init; } = new();
    public WakeTime Now { get; init; } = new();
    public SpotYaw? At { get; init; }
}

/// <summary>M7 sleep: how a sleep ended.</summary>
public sealed record RestEnd
{
    public string Place { get; init; } = "";
    public string Label { get; init; } = "";
    public string? Home { get; init; }
    public string? Bench { get; init; }
    /// <summary>"rested", "up", "police", "robbed" or "ended".</summary>
    public string Reason { get; init; } = "";
    public double SleptMin { get; init; }
    public double PlannedMin { get; init; }
    public List<string> Lines { get; init; } = new();
    public WakeTime Wake { get; init; } = new();
    public bool Turned { get; init; }
    public Ending? Ended { get; init; }
    public Robbed? Robbed { get; init; }
}

public sealed record Pos3(double X, double Z, double Y);

/// <summary>M7 sleep: what the game asks for. Hours: 1 to 12, or the word "morning".</summary>
public sealed record RestAsk
{
    public string Place { get; init; } = "";
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Bench { get; init; }
    public object Hours { get; init; } = 8;
    public Pos3 Pos { get; init; } = new(0, 0, 0);
}

/// <summary>M7 night: the date turned at midnight.</summary>
public sealed record DayTurn
{
    public int Day { get; init; }
    public List<string> Lines { get; init; } = new();
    public Ending? Ended { get; init; }
}

/// <summary>M7 warmth: where Jef is, as the game says it with each tick: a room's id, or null outside.</summary>
public sealed record WhereReport(string? At, bool Lantern);

/// <summary>M7 warmth: where the server believes Jef is.</summary>
public sealed record WhereNow
{
    /// <summary>"outside", "heated" or "sheltered".</summary>
    public string Shelter { get; init; } = "outside";
    public string? Place { get; init; }
    public string Label { get; init; } = "";
    public bool Lantern { get; init; }
}

public sealed record TickReply : JobsPayload
{
    public bool Advanced { get; init; }
    public Night? Night { get; init; }
    public Ending? Ended { get; init; }
    public DayTurn? Turned { get; init; }
    public WhereNow? Where { get; init; }
    public RestView? Rest { get; init; }
    public RestEnd? Woke { get; init; }
}

/// <summary>What happened in 3D, sent when a job ends. The server turns it into money. Only what is set is sent.</summary>
public sealed record Report
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public int? Delivered { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public int? Lost { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public int? Sold { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? Pocketed { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? Late { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public double? LeftPostS { get; init; }
    /// <summary>"none", "chased" or "stole".</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Thief { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? BribeTaken { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? SeenAway { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public int? Turns { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? Box { get; init; }
}

public sealed record Settlement
{
    public int PayC { get; init; }
    public int ExtraC { get; init; }
    public double TrustDelta { get; init; }
    public bool Caught { get; init; }
    public string Status { get; init; } = "";
    public List<string> Facts { get; init; } = new();
}

/// <summary>What an NPC says. Trust stays on the server.</summary>
public sealed record TalkLine
{
    public string? NpcLine { get; init; }
    public string? Mood { get; init; }
    public List<string>? Choices { get; init; }
    public bool? End { get; init; }
    public string? Gated { get; init; }
    public string? Note { get; init; }
    public List<Ware>? Wares { get; init; }
    /// <summary>False: the choices only, no typing (no AI).</summary>
    public bool? Free { get; init; }
}

public sealed record Npc
{
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public string Role { get; init; } = "";
    public List<Ware> Wares { get; init; } = new();
}

public sealed record OkReply
{
    public bool Ok { get; init; }
}

public sealed record JobReply
{
    public Job Job { get; init; } = new();
}

public sealed record BuyReply : JobsPayload
{
    public string Line { get; init; } = "";
    public int PriceC { get; init; }
}

public sealed record TextReply : JobsPayload
{
    public string Text { get; init; } = "";
}

public sealed record HoldReply : JobsPayload
{
    public Job Job { get; init; } = new();
}

public sealed record AdvanceReply : JobsPayload
{
    public List<string> Lines { get; init; } = new();
    public bool Turned { get; init; }
}

public sealed record SleepReply : JobsPayload
{
    public RestView? Rest { get; init; }
}

public sealed record WakeReply : JobsPayload
{
    public RestEnd? Woke { get; init; }
}

public sealed record RentReply : JobsPayload
{
    public bool Paid { get; init; }
    public string Text { get; init; } = "";
}

public sealed record SwimReply : JobsPayload
{
    public bool Cold { get; init; }
}

public sealed record RideReply : JobsPayload
{
    public string Text { get; init; } = "";
    public int? FareC { get; init; }
    public bool? Change { get; init; }
}

public sealed record PickReply : JobsPayload
{
    public int TookC { get; init; }
    public bool Felt { get; init; }
    public string Text { get; init; } = "";
}

public sealed record CatchReply : JobsPayload
{
    public int BackC { get; init; }
    public string Text { get; init; } = "";
}

public sealed record GiveUpPay
{
    public int PayC { get; init; }
}

public sealed record GiveUpReply
{
    public GiveUpPay Settlement { get; init; } = new();
    public int MoneyC { get; init; }
}

public sealed record DoneReply
{
    public Job Job { get; init; } = new();
    public Settlement Settlement { get; init; } = new();
    public int MoneyC { get; init; }
}

public sealed record LagsReply
{
    public Dictionary<string, double> Lags { get; init; } = new();
}

/// <summary>A townsperson's way on foot: points [x, z]; null when the server found none.</summary>
public sealed record WaysReply
{
    public Dictionary<string, List<double[]>?> Ways { get; init; } = new();
}

/// <summary>The bucket chain or the natie gate (api.ts TownLifeResult): Ok with Text, or not with Why.</summary>
public sealed record TownLifeResult
{
    public bool Ok { get; init; }
    public string? Text { get; init; }
    public string? Why { get; init; }
}

public sealed record TownLifeReply : JobsPayload
{
    public TownLifeResult Result { get; init; } = new();
}

/// <summary>A townsperson where the host's game moves him unseen off his plan (the town map).</summary>
public sealed record MapOff
{
    public string Id { get; init; } = "";
    public double X { get; init; }
    public double Z { get; init; }
    public string Why { get; init; } = "";
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? In { get; init; }
}

public sealed record PersonAt(string Id, double X, double Z);

/// <summary>A job's news on the push channel: how it went, in the employer's words.</summary>
public sealed record OutcomeMsg
{
    public int JobId { get; init; }
    public string Text { get; init; } = "";
    public string Employer { get; init; } = "";
}

/// <summary>Anything else the server pushes (actions, events, convo, gate, loaded, resync ...): its type, and the whole message.</summary>
public sealed record PushMsg(string Type, JsonElement Body);

// ---- M4: townspeople who act, conversations in the street, the director's events (api.ts ActionsPayload)

public sealed record PublicAction
{
    public int Id { get; init; }
    public string Npc { get; init; } = "";
    public string Name { get; init; } = "";
    /// <summary>"none", "follow", "go_to", "wait", "talk_to", "look_for", "fetch_police", "give", "stop" or "attend".</summary>
    public string Kind { get; init; } = "";
    public string Target { get; init; } = "";
    public string? TargetName { get; init; }
    public double? TargetX { get; init; }
    public double? TargetZ { get; init; }
    /// <summary>"talk", "director", "event" or "engine".</summary>
    public string Source { get; init; } = "";
    public int? EventId { get; init; }
    public string Phase { get; init; } = "";
    public double Until { get; init; }
    public double MaxM { get; init; }
    public int Order { get; init; }
    public string? Role { get; init; }
    public string? Lead { get; init; }
    public int N { get; init; }
    public double MinutesLeft { get; init; }
    /// <summary>M8d: the player it is about; null: the host, or an event's.</summary>
    public int? ForPlayer { get; init; }
}

public sealed record ConvoLine
{
    public string Who { get; init; } = "";
    public string Name { get; init; } = "";
    public string Text { get; init; } = "";
}

public sealed record Convo
{
    public int Id { get; init; }
    public string A { get; init; } = "";
    public string B { get; init; } = "";
    public string AName { get; init; } = "";
    public string BName { get; init; } = "";
    public string Purpose { get; init; } = "";
    public List<ConvoLine> Lines { get; init; } = new();
    public string Source { get; init; } = "";
    public string Outcome { get; init; } = "";
    public double At { get; init; }
    public int? EventId { get; init; }
}

public sealed record EventCue
{
    public string Source { get; init; } = "";
    public double EveryS { get; init; }
    public double Pitch { get; init; }
    public double Level { get; init; }
}

public sealed record EventStage
{
    public string Op { get; init; } = "";
    public double Minutes { get; init; }
    public string Sound { get; init; } = "none";
    public string Mood { get; init; } = "";
    public string Props { get; init; } = "none";
    public double X { get; init; }
    public double Z { get; init; }
    public string Label { get; init; } = "";
    public string Text { get; init; } = "";
    public int Count { get; init; }
    public List<string> Leads { get; init; } = new();
    public List<EventCue>? Cues { get; init; }
    /// <summary>M7 funeral ("depart"): the road out, the hearse, the groups going home; as the server sent them.</summary>
    public JsonElement? Exit { get; init; }
    public List<double[]>? Route { get; init; }
    public bool? Hearse { get; init; }
    public JsonElement? Groups { get; init; }
}

public sealed record EventLead
{
    public string Role { get; init; } = "";
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public int N { get; init; }
}

public sealed record TownEvent
{
    public int Id { get; init; }
    public string Title { get; init; } = "";
    public string Template { get; init; } = "";
    public string Place { get; init; } = "";
    public double X { get; init; }
    public double Z { get; init; }
    public double R { get; init; }
    /// <summary>"planned", "running", "done" or "cancelled".</summary>
    public string Status { get; init; } = "";
    public int Stage { get; init; }
    public List<EventStage> Stages { get; init; } = new();
    public List<string> People { get; init; } = new();
    public List<EventLead> Leads { get; init; } = new();
    /// <summary>M4b: a scuffle or a robbery as the engine set it up (api.ts EventScene), as sent.</summary>
    public JsonElement? Scene { get; init; }
    public double StageLeft { get; init; }
    public double StartsIn { get; init; }
    public double EndsIn { get; init; }
    public string Source { get; init; } = "";
    public List<string?>? Acts { get; init; }
    public JsonElement? Fire { get; init; }
    public JsonElement? Hiring { get; init; }
    public JsonElement? Tempest { get; init; }
}

public sealed record ActionsPayload
{
    public List<PublicAction> Actions { get; init; } = new();
    public List<Convo> Convos { get; init; } = new();
    public List<TownEvent> Events { get; init; } = new();
    public List<string> Closed { get; init; } = new();
}

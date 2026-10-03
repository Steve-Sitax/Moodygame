using System.Collections.Generic;
using Scheldemist.Net;

namespace Scheldemist.Talks;

// What the server sends for the paper, the post and the pawn office (client/src/game/press.ts, server/src/paper/),
// the bills on the walls and a lost notebook (client/src/game/ideas.ts), and the dice (client/src/net/interiorApi.ts).
// The JSON names are the server's (price_c, clerk_name): Api.Json turns PriceC into price_c by itself.

public sealed record PaperToday
{
    public int Day { get; init; }
    public string Name { get; init; } = "";
    public int PriceC { get; init; }
    public bool Printed { get; init; }
    public string? Cry { get; init; }
    public string? Headline { get; init; }
}

public sealed record NewsCorner
{
    public string Id { get; init; } = "";
    public string Label { get; init; } = "";
    public double X { get; init; }
    public double Z { get; init; }
    public double Yaw { get; init; }
    public string Boy { get; init; } = "";
}

public sealed record SpotAt
{
    public double X { get; init; }
    public double Z { get; init; }
}

public sealed record PostPlace
{
    public double[] Step { get; init; } = System.Array.Empty<double>();
    public double[] Wall { get; init; } = System.Array.Empty<double>();
    public double[] Out { get; init; } = System.Array.Empty<double>();
    public string Label { get; init; } = "";
    public string Clerk { get; init; } = "";
    public SpotAt? At { get; init; }
}

public sealed record BergPlace
{
    public string Shop { get; init; } = "";
    public string Clerk { get; init; } = "";
    public string Label { get; init; } = "";
    public double[] Door { get; init; } = System.Array.Empty<double>();
    public double[] Wall { get; init; } = System.Array.Empty<double>();
    public double[] Out { get; init; } = System.Array.Empty<double>();
}

/// <summary>GET /api/press: today's paper, the newsboys' corners, where the post office and the Berg are.</summary>
public sealed record PressInfo
{
    public PaperToday? Paper { get; init; }
    public List<NewsCorner>? Corners { get; init; }
    public PostPlace? Post { get; init; }
    public BergPlace? Berg { get; init; }
}

public sealed record Article
{
    public int Fact { get; init; }
    public string Kind { get; init; } = "";
    public string Headline { get; init; } = "";
    public string Text { get; init; } = "";
}

public sealed record ShipLine
{
    public int Ship { get; init; }
    /// <summary>"in" or "out".</summary>
    public string Dir { get; init; } = "";
    public string Line { get; init; } = "";
}

/// <summary>GET /api/paper/:day: one day's paper, for him who has it in a pocket.</summary>
public sealed record PaperPage
{
    public int Day { get; init; }
    public string Name { get; init; } = "";
    public string Date { get; init; } = "";
    public int PriceC { get; init; }
    public string Cry { get; init; } = "";
    public string Headline { get; init; } = "";
    public List<Article> Articles { get; init; } = new();
    public List<ShipLine> Shipping { get; init; } = new();
    /// <summary>The day's work, in the engine's words.</summary>
    public List<string>? Notices { get; init; }
    public string Source { get; init; } = "";
}

public sealed record LetterOffer
{
    public string Kind { get; init; } = "";
    public int PayC { get; init; }
    public int FeeC { get; init; }
    public string? ToName { get; init; }
    public string? City { get; init; }
}

public sealed record LetterJob
{
    public int Id { get; init; }
    public string Status { get; init; } = "";
    public string Title { get; init; } = "";
    public int PayC { get; init; }
    public bool Today { get; init; }
}

/// <summary>GET /api/letter/:id.</summary>
public sealed record LetterView
{
    public int Id { get; init; }
    public string Date { get; init; } = "";
    public string From { get; init; } = "";
    public string Salutation { get; init; } = "";
    public string Body { get; init; } = "";
    public string Closing { get; init; } = "";
    public string Signature { get; init; } = "";
    public string? Telegram { get; init; }
    public LetterOffer? Offer { get; init; }
    public LetterJob? Job { get; init; }
}

public sealed record BergOffer
{
    public int Item { get; init; }
    public string Kind { get; init; } = "";
    public string Name { get; init; } = "";
    public int LoanC { get; init; }
}

public sealed record BergTicket
{
    public int Id { get; init; }
    public string Name { get; init; } = "";
    public int LoanC { get; init; }
    public int RateC { get; init; }
    public int DueDay { get; init; }
    public int RedeemC { get; init; }
}

/// <summary>GET /api/berg: the pawn office's counter.</summary>
public sealed record BergView
{
    public string Label { get; init; } = "";
    public string? Clerk { get; init; }
    public string? ClerkName { get; init; }
    public bool Open { get; init; }
    public int Day { get; init; }
    public List<BergOffer> Offers { get; init; } = new();
    public List<BergTicket> Tickets { get; init; } = new();
    public string Terms { get; init; } = "";
}

/// <summary>GET /api/post: the post office's counter.</summary>
public sealed record PostView
{
    public string Label { get; init; } = "";
    public string? Clerk { get; init; }
    public string? ClerkName { get; init; }
    public bool Open { get; init; }
    public int Waiting { get; init; }
    public int TelegramFeeC { get; init; }
    public int TelegramWords { get; init; }
    public Job? Round { get; init; }
}

/// <summary>GET /api/ticket/:id: a pawn ticket.</summary>
public sealed record TicketView
{
    public int No { get; init; }
    public string Name { get; init; } = "";
    public int LoanC { get; init; }
    public int RateC { get; init; }
    public int Day { get; init; }
    public string Due { get; init; } = "";
    public int RedeemC { get; init; }
    public string Status { get; init; } = "";
}

/// <summary>A counter's answer: the game state and a line to say.</summary>
public sealed record CounterReply : JobsPayload
{
    public string Text { get; init; } = "";
}

public sealed record BillText
{
    public string Heading { get; init; } = "";
    public string Body { get; init; } = "";
    public string Footer { get; init; } = "";
}

public sealed record BillSpot
{
    public string Id { get; init; } = "";
    public string Label { get; init; } = "";
    public double[] At { get; init; } = System.Array.Empty<double>();
}

/// <summary>A bill on a wall (GET /api/ideas, "posters"): wanted, lost, sailing, auction ...</summary>
public sealed record Bill
{
    public int Id { get; init; }
    public string Kind { get; init; } = "";
    public BillSpot? Spot { get; init; }
    public int Day { get; init; }
    public BillText Text { get; init; } = new();
    public bool NamesJef { get; init; }
    public int RewardC { get; init; }
    public string Source { get; init; } = "";
}

public sealed record IdeasView
{
    public List<Bill>? Posters { get; init; }
}

public sealed record DiaryEntry
{
    public string Date { get; init; } = "";
    public string Text { get; init; } = "";
}

/// <summary>GET /api/diary/:id: a lost notebook.</summary>
public sealed record DiaryView
{
    public string Owner { get; init; } = "";
    public string Near { get; init; } = "";
    public List<DiaryEntry> Entries { get; init; } = new();
    public int SellC { get; init; }
}

public sealed record DiceLeft
{
    public int Games { get; init; }
    public int LossC { get; init; }
}

public sealed record DiceThrow
{
    public int[] Dice { get; init; } = System.Array.Empty<int>();
    public int Rank { get; init; }
    public int Points { get; init; }
    public string Name { get; init; } = "";
}

/// <summary>POST /api/interior/dice/sit.</summary>
public sealed record DiceSit
{
    public string Line { get; init; } = "";
    public List<int> Stakes { get; init; } = new();
    public DiceLeft Left { get; init; } = new();
    public string Source { get; init; } = "";
}

/// <summary>POST /api/interior/dice/throw.</summary>
public sealed record DiceResult : JobsPayload
{
    public DiceThrow Jef { get; init; } = new();
    public DiceThrow Them { get; init; } = new();
    public int Result { get; init; }
    public int NetC { get; init; }
    public string Line { get; init; } = "";
    public DiceLeft Left { get; init; } = new();
}

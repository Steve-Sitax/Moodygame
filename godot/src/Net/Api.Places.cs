using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;

namespace Scheldemist.Net;

public sealed record ConfessionBegin(string Line,string Priest);
public sealed record ConfessionReply(string Line,string? Penance,string Source,string? Gated);
public sealed record ConfessionEnd(string Line);
public sealed record JobCart(string Id,string Kind,int? Job,string? Lender,float X,float Z);
public sealed record JobCarts(List<JobCart> List);
public sealed record LampPoint(string Id, float X, float Z, float Sx, float Sz, bool Done);
public sealed record WorkPoint(float X, float Z, string Label);
public sealed record LampsTask
{
    public string Kind { get; init; } = "lamps";
    public WorkPoint Pole { get; init; } = new(0, 0, "");
    public List<LampPoint> Lamps { get; init; } = new();
    public bool Picked { get; init; }
    public double Open { get; init; }
    public double Until { get; init; }
    public static LampsTask? Of(Job j) => j.Task is { ValueKind: JsonValueKind.Object } t && t.TryGetProperty("kind", out var k) && k.GetString() == "lamps" ? t.Deserialize<LampsTask>(Api.Json) : null;
}
public sealed record PlacesReply : JobsPayload
{
    public string Text { get; init; } = "";
    public int Left { get; init; }
}
public sealed record LampAsk(int Job, float X, float Z, string? Lamp = null);
public sealed record ParkPile(int Id, float X, float Z, int? Owner);
public sealed record ParkShift(List<int> Ids, List<int> Cleaned, bool Paid);
public sealed record ParkView(int Day, List<ParkPile> Piles, ParkShift? Shift, bool Open);
public sealed record ParkAsk(WorkPoint At, int? Id = null);
public sealed record ParkReply(string Text, ParkView Park, JobsPayload State);
public sealed record HomeDoor(string Id, string Cls, string Label, float[] Step, float[] Wall, float[] Out, int WeekC, int DayC, int ToSundayC, string Notice);
public sealed record HomeLease(string Home, int OwedC, int ToSundayC, int DayC, bool Fire, List<string> Words);
public sealed record HomeItem(int Id, string Kind, string Name, string State, string? Home, int? Gx, int? Gz, int Rot);
public sealed record HomeDealer(string Id, string Label, float[] At);
public sealed record HomesView(List<HomeDoor> Homes, HomeLease? Lease, List<HomeItem> Items)
{
    public HomeDealer? Dealer { get; init; }
}
public sealed record HomeReply : JobsPayload { public string Text { get; init; } = ""; public int PaidC { get; init; } public HomesView Homes { get; init; } = new(new(), null, new()); }
public sealed record HomeTake(string Home, string Plan);
public sealed record HomePlace(int Id, int Gx, int Gz, int Rot);
public sealed record BalladWords(string Title, List<List<string>> Verses, List<string> Chorus);
public sealed record BalladPerson(string Id, string Name, string First, string Sex, int Age);
public sealed record Singing(string Kind, string Place, float? X, float? Z, string Status);
public sealed record BalladView(int Day, int PriceC, BalladWords? Ballad, bool Writing, BalladPerson? Singer, Singing? Singing, bool HaveSheet);
public sealed record BalladSheet(string Title, List<List<string>> Verses, List<string> Chorus, string Weekday);
public sealed record DockBook(bool Book, bool Ok, string Line);
public sealed record LandmarkPerson(string Id, string Name, string First, string Role, string? Title);
public sealed record LandmarkPoster(string Heading, string Body, string Footer);
public sealed record LandmarkView(string Id, bool Open, List<LandmarkPerson> People, List<string> Register, List<LandmarkPoster> Posters, JsonElement? Wedding, JsonElement? Civil, JsonElement? Confession) { public JsonElement? Service { get; init; } public bool Organ { get; init; } public bool Barred { get; init; } }
public sealed record SermonGossip(string Id, string Name, string? To, string Text);
public sealed record SermonView(int Day, List<string> Lines, bool Heard) { public List<string> Nodders { get; init; } = new(); public SermonGossip? Gossip { get; init; } }
public sealed record SermonReply : JobsPayload { public int Delta { get; init; } public string Text { get; init; } = ""; }
public sealed record CounterKeeper(string Id, string Name, string First);
public sealed record InsideDoor(string Place, string Label, bool Open, CounterKeeper? Keeper);
public sealed record InsideDoors(List<InsideDoor> Taverns);
public sealed record ShopDoors(List<InsideDoor> Shops);
public sealed record InsidePerson(string Id, string Name, string First, string Kind, string Sex, int Age, bool Stand, string? Role);
public sealed record TavernView(string Place, bool Open, List<InsidePerson> Patrons);
public sealed record EmigrantProp(string Kind, float X, float Z, float Yaw);
public sealed record EmigrantBaby(string Mother, string Child);
public sealed record EmigrantFamily(int N, int Household, string Surname, string From, int Slot, List<string> Members, string Head, EmigrantBaby? Baby, List<EmigrantProp> Props, int BoardDay, bool BoardingToday, bool WaitingForJef, double ArrivedAt, string? Luggage);
public sealed record EmigrantShip(bool Today, float From, float To, int Next);
public sealed record EmigrantBoarded(int Household, string Surname, string By);
public sealed record EmigrantView(int Day, float Hour, EmigrantShip Ship, List<EmigrantFamily> Families, List<EmigrantBoarded> Boarded);
public sealed record EmigrantBoard(bool Ok, string? Why, EmigrantView View);
public sealed record PlayLine(string Who, string Text);
public sealed record PoesjePlay(string State, string? Title, string? Third, List<PlayLine>? Lines);
public sealed record PoesjeView(bool Open, int PriceC, PoesjePlay Play, List<InsidePerson> Audience);
public sealed record PoesjeTicket : JobsPayload { public int PaidC { get; init; } public string Line { get; init; } = ""; }
public sealed partial class Api
{
    public Task<PlacesReply> LampPole(LampAsk ask) => Post<PlacesReply>("api/lamps/pole", ask);
    public Task<PlacesReply> LampLight(LampAsk ask) => Post<PlacesReply>("api/lamps/light", ask);
    public Task<ParkView> ParkInfo() => Get<ParkView>("api/park");
    public Task<ParkReply> ParkAction(string action, ParkAsk ask) => Post<ParkReply>("api/park/" + action, ask);
    public Task<HomesView> HomesInfo() => Get<HomesView>("api/homes");
    public Task<HomeReply> HomeTake(HomeTake ask) => Post<HomeReply>("api/homes/take", ask);
    public Task<HomeReply> HomeRent(string plan) => Post<HomeReply>("api/homes/rent", new { plan });
    public Task<HomeReply> HomeWarm() => Post<HomeReply>("api/homes/stove");
    public Task<HomeReply> HomePlace(HomePlace ask) => Post<HomeReply>("api/homes/place", ask);
    public Task<HomeReply> HomeLift(int id) => Post<HomeReply>("api/homes/lift", new { id });
    public Task<HomeReply> HomeAbandon() => Post<HomeReply>("api/homes/abandon");
    public Task<BalladView> BalladInfo() => Get<BalladView>("api/ballad");
    public Task<BalladView> BalladToday() => Post<BalladView>("api/ballad/today", new { }, TalkTimeoutMs);
    public Task<PlacesReply> BalladBuy() => Post<PlacesReply>("api/ballad/buy", new { });
    public Task<BalladSheet> BalladSheet(int day) => Get<BalladSheet>("api/ballad/sheet/" + day);
    public Task<DockBook> DockBook() => Get<DockBook>("api/docks/book");
    public Task<DockBook> DockSign() => Post<DockBook>("api/docks/book");
    public Task<PlacesReply> LandmarkChair() => Post<PlacesReply>("api/landmark/chair",new{});
    public Task<ConfessionBegin> ConfessionBegin() => Post<ConfessionBegin>("api/landmark/confess/begin",new{});
    public Task<ConfessionReply> Confess(string text) => Post<ConfessionReply>("api/landmark/confess",new{text},TalkTimeoutMs);
    public Task<ConfessionEnd> ConfessionEnd() => Post<ConfessionEnd>("api/landmark/confess/end",new{});
    public Task<LandmarkView> LandmarkNow(string id) => Get<LandmarkView>("api/landmark/" + id);
    public Task<OkReply> LandmarkHere(string? id) => Post<OkReply>("api/landmark/here", new { id });
    public Task<PlacesReply> LandmarkCandle() => Post<PlacesReply>("api/landmark/candle", new { });
    public Task<SermonView> Sermon() => Get<SermonView>("api/sermon", TalkTimeoutMs);
    public Task<SermonReply> SermonHeard() => Post<SermonReply>("api/sermon/heard", new { });
    public Task<InsideDoors> InsideDoors() => Get<InsideDoors>("api/interiors");
    public Task<ShopDoors> ShopDoors() => Get<ShopDoors>("api/shops");
    public Task<TavernView> Tavern(string place) => Get<TavernView>("api/interior/" + Esc(place));
    public Task<EmigrantView> Emigrants() => Get<EmigrantView>("api/emigrants");
    public Task<EmigrantBoard> EmigrantBoard(int household) => Post<EmigrantBoard>("api/emigrants/board", new { household });
    public Task<JobCarts> JobCartLoans() => Get<JobCarts>("api/cart");
    public Task<PoesjeView> Poesje() => Get<PoesjeView>("api/poesje");
    public Task<PoesjeTicket> PoesjeEnter() => Post<PoesjeTicket>("api/poesje/enter");
    public Task<PoesjePlay> PoesjePlay() => Post<PoesjePlay>("api/poesje/play", new { }, TalkTimeoutMs);
}

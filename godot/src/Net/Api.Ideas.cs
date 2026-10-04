using System.Collections.Generic;
using System.Threading.Tasks;

namespace Scheldemist.Net;

public sealed partial class Api
{
    public Task<IdeaWorld> IdeaWorld() => Get<IdeaWorld>("api/ideas");
    public Task<LetterOptions> LetterOptions() => Get<LetterOptions>("api/post/write");
    public Task<IdeaReply> IdeaAction(string path, double x, double z) => Post<IdeaReply>(path, new { x, z });
    public Task<IdeaReply> SendLetter(string to, string words, double x, double z) => Post<IdeaReply>("api/post/write", new { to, text = words, x, z });
}
public sealed record IdeaWorld
{
    public List<Scheldemist.Talks.Bill> Posters { get; init; } = new();
    public List<LostIdea> Lost { get; init; } = new();
    public List<DiaryIdea> Diaries { get; init; } = new();
    public List<MeetingIdea> Meetings { get; init; } = new();
}
public sealed record LostIdea
{
    public int Poster { get; init; } public string What { get; init; } = ""; public LostDog? Dog { get; init; }
    public float X { get; init; } public float Z { get; init; } public string State { get; init; } = "";
    public string OwnerName { get; init; } = ""; public double[]? Door { get; init; } public int RewardC { get; init; }
}
public sealed record LostDog { public string Name { get; init; } = ""; public string Look { get; init; } = ""; }
public sealed record DiaryIdea
{
    public int Id { get; init; } public string Status { get; init; } = ""; public float X { get; init; } public float Z { get; init; }
    public string OwnerName { get; init; } = ""; public double[]? Door { get; init; }
}
public sealed record MeetingIdea
{
    public int Id { get; init; } public string Name { get; init; } = ""; public float X { get; init; } public float Z { get; init; }
    public double FromH { get; init; } public double ToH { get; init; } public string Label { get; init; } = "";
}
public sealed record LetterOptions { public List<LetterTo> To { get; init; } = new(); public int StampC { get; init; } public int MaxChars { get; init; } }
public sealed record LetterTo { public string Id { get; init; } = ""; public string Name { get; init; } = ""; public string Trade { get; init; } = ""; public string Near { get; init; } = ""; }
public sealed record IdeaReply : JobsPayload { public string Text { get; init; } = ""; }

using System;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.People;
using Scheldemist.Talks;
using Scheldemist.Town;
namespace Scheldemist.Play;

/// <summary>homes.ts cameIn/lookIn. One engine-selected remark per home and game day.</summary>
[GamePart(364)]
public partial class HomeRemarks : Node
{
    public static HomeRemarks? I { get; private set; }
    public int Requests { get; private set; }
    public HomeRemark? Last { get; private set; }
    private string? inside, askedHome;
    private int askedDay, generation;
    private bool busy;
    private double poll;
    public override void _Ready() { I = this; if (Menu.MainMenu.I is { } menu) menu.WorldReplaced += Reset; }
    private void Reset(string how, ClientState? state) { generation++; Dismiss(); askedHome = null; askedDay = 0; Last = null; }
    private void Dismiss() { if (inside != null) HomeVisitors.I?.Visit("home:" + inside, null); inside = null; }
    public override void _Process(double delta)
    {
        if ((poll -= delta) > 0) return;
        poll = .25;
        var homes = HomeLife.I;
        string? room = homes.Info?.Lease is { } lease && homes.Frames.TryGetValue(lease.Home, out var frame) && frame.Inside && ServerLink.I?.Api?.Guest == false ? lease.Home : null;
        if (room != inside)
        {
            Dismiss(); inside = room;
            if (room != null && homes.Info?.Lease is { } l) GameState.I.Say($"It feels {string.Join(", ", l.Words)}.");
        }
        if (room == null || busy || askedHome == room && askedDay == GameState.I.Day) return;
        askedHome = room; askedDay = GameState.I.Day;
        _ = Ask(room);
    }
    private async Task Ask(string home)
    {
        if (ServerLink.I?.Api is not { } api) return;
        busy = true; int g = generation; Requests++;
        try
        {
            var reply = await api.HomeRemark();
            if (g != generation || inside != home || reply.Remark is not { } remark) return;
            Last = remark;
            var r = remark.Who;
            var person = new Resident { Id = r.Id, Name = r.Name, First = r.First, Kind = r.Kind, Sex = r.Sex, Age = r.Age };
            if (HomeVisitors.I?.Visit("home:" + home, person) != true) return;
            Bubbles.I?.Say(() => (HomeVisitors.I?.PositionOf(r.Id) ?? Vector3.Zero) + Vector3.Up * 1.75f, r.First, remark.Line, r.Id);
        }
        catch (ApiException) { }
        finally { busy = false; }
    }
    public override void _ExitTree() { generation++; Dismiss(); if (Menu.MainMenu.I is { } menu) menu.WorldReplaced -= Reset; if (I == this) I = null; }
}

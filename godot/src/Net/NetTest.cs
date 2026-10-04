using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Game;

namespace Scheldemist.Net;

/// <summary>
/// The net part's own test: `-- --nettest dir`. The game starts its server (no model calls), waits for the first
/// state, asks for one tick of the clock, says a line in the middle, saves a picture of the screen with the HUD
/// (dir/nettest.png) and what it got (dir/nettest.json), and quits. The server must be gone afterwards: the json
/// names its port and process, for a look with netstat. Quits with 1 and the reason in the json when a step
/// does not come in time.
/// </summary>
[GamePart(200)]
public partial class NetTest : Node
{
    private const double FirstStateS = 100; // the server's own start limit is 90 s
    private const double StepS = 15;
    private string dir = "";
    private string step = "server";
    private double inStep;
    private double total;
    private int frames;
    private bool pushed;
    private bool polled;
    private TickReply? tick;
    private Func<bool>? playingWas;
    private double pauseAsked;
    private bool gateBusy;
    private bool? pausedSeen, heldWhilePaused, unpausedSeen;
    private bool cameAfter;
    private int pushes, pushedBefore;
    private readonly Dictionary<string, double> at = new();
    private readonly List<string> events = new();

    public override void _Ready()
    {
        dir = Paths.TestOutput("nettest");
        if (dir == "")
        {
            SetProcess(false);
            return;
        }
        Directory.CreateDirectory(dir);
        var st = GameState.I;
        st.FirstState += () => events.Add("FirstState");
        st.ClockChanged += () => events.Add($"ClockChanged {st.Weekday} {st.Hour}:{st.Minute:00}");
        st.WeatherChanged += w => events.Add($"WeatherChanged {w}");
        st.NeedsChanged += () => events.Add("NeedsChanged");
        st.MoneyChanged += c => events.Add($"MoneyChanged {c}");
        st.PocketsChanged += () => events.Add("PocketsChanged");
        st.Message += m => events.Add($"Message {m}");
        if (ServerLink.I is not { } link)
        {
            Fail("the server link is off (--no-serverlink)");
            return;
        }
        link.WhenUp(() =>
        {
            at["server_up_s"] = Math.Round(total, 2);
            link.Api!.JobsPushed += _ =>
            {
                pushed = true;
                pushes++;
            };
            // the calls beside the state: a plain list, and a refusal with the server's own words
            link.Api.Run(link.Api.Npcs(), n => events.Add($"npcs {n.Count}"), e => events.Add($"npcs failed: {e.Message}"));
            link.Api.Run(link.Api.Take(999999), _ => events.Add("take 999999: taken?"), e => events.Add($"take 999999 refused ({e.Status}): {e.Message}"));
            link.Api.Run(link.Api.Jobs(), _ => polled = true, e => events.Add($"jobs failed: {e.Message}"));
        });
        link.Ticked += r => tick = r;
    }

    private void Next(string name)
    {
        at[step + "_s"] = Math.Round(total, 2);
        step = name;
        inStep = 0;
        frames = 0;
    }

    public override void _Process(double delta)
    {
        if (step == "done") return;
        total += delta;
        inStep += delta;
        frames++;
        var link = ServerLink.I;
        var st = GameState.I;
        switch (step)
        {
            case "server":
                if (link?.Error is { Length: > 0 } why) Fail(why);
                else if (st.Live && pushed && polled) Next("tick");
                else if (inStep > FirstStateS) Fail($"no first state in {FirstStateS} s (live {st.Live}, push {pushed}, poll {polled})");
                break;
            case "tick":
                if (frames == 1)
                {
                    // Jef is in play for the length of one tick (the free camera alone stops the clock)
                    playingWas = st.PlayingWhen;
                    st.PlayingWhen = () => true;
                    link!.Tick();
                }
                if (tick != null)
                {
                    st.PlayingWhen = playingWas;
                    Next("pause");
                }
                else if (inStep > StepS) Fail("the tick did not come back");
                break;
            case "pause":
                // the pause: the server hears it (its gate says paused), a push meanwhile waits, the unpause lets it through
                if (frames == 1)
                {
                    ProcessMode = ProcessModeEnum.Always; // (this test runs on while paused)
                    link!.SetPause("key", true);
                    pauseAsked = total;
                }
                if (pausedSeen == null && total - pauseAsked > 0.4 && !gateBusy)
                {
                    gateBusy = true;
                    link!.Api!.Run(link.Api.Gate(), g =>
                    {
                        gateBusy = false;
                        if (!g.Paused) return;
                        pausedSeen = true;
                        pushedBefore = pushes;
                        // a push while paused (the server pushes the state after a dev set of the money): held until the unpause
                        link.Api.Run(link.Api.DevSet(new Dictionary<string, double> { ["money_c"] = 61 }), _ => { }, e => events.Add($"dev set failed: {e.Message}"));
                        pauseAsked = total;
                    }, _ => gateBusy = false);
                }
                if (pausedSeen == true && heldWhilePaused == null && total - pauseAsked > 1.0)
                {
                    heldWhilePaused = pushes == pushedBefore;
                    link!.SetPause("key", false);
                    pauseAsked = total;
                }
                if (heldWhilePaused != null && unpausedSeen == null && total - pauseAsked > 0.5 && !gateBusy)
                {
                    gateBusy = true;
                    link!.Api!.Run(link.Api.Gate(), g =>
                    {
                        gateBusy = false;
                        if (g.Paused) return;
                        unpausedSeen = true;
                        cameAfter = pushes > pushedBefore;
                    }, _ => gateBusy = false);
                }
                if (unpausedSeen == true) Next("extras");
                else if (inStep > StepS) Fail($"the pause did not go through (paused seen {pausedSeen}, held {heldWhilePaused}, unpaused {unpausedSeen})");
                break;
            case "extras":
                if (frames == 1)
                {
                    // something in a pocket (a real buy), a job in hand for the task card, an outcome note, the line in the middle
                    var api = link!.Api!;
                    api.Run(api.Buy("fientje", "herring"), b =>
                    {
                        events.Add($"bought herring for {b.PriceC} c: {b.Line}");
                        st.Apply(b);
                    }, e => events.Add($"buy failed ({e.Status}): {e.Message}"));
                    var first = st.Jobs.FirstOrDefault(j => j.Status == "offered" && j.Playable);
                    if (first != null)
                        api.Run(api.Take(first.Id), r =>
                        {
                            events.Add($"took job {r.Job.Id}: {r.Job.Title}");
                            api.Run(api.Jobs(), st.Apply);
                        }, e => events.Add($"take failed ({e.Status}): {e.Message}"));
                    Hud.I?.Outcome("Sooi", "Both crates stand dry under the crane. You have hands, I will say that; come back tomorrow.");
                    st.Say("Day work is given out at the Hessenatie's board on the Rijnkaai, along the quay past the Steen.");
                }
                if (inStep > 1.2) Next("picture");
                break;
            case "picture":
                // the line in the middle fades in over 0.6 s; the town has drawn by then
                if (inStep < 1.5 || frames < 30) break;
                GetViewport().GetTexture().GetImage().SavePng(Path.Combine(dir, "nettest.png"));
                Write(true, "");
                Next("done");
                GetTree().Quit();
                break;
            case "failing":
                if (frames < 12) break;
                GetViewport().GetTexture().GetImage().SavePng(Path.Combine(dir, "nettest-failed.png"));
                Write(false, failed);
                step = "done";
                GetTree().Quit(1);
                break;
        }
    }

    private string failed = "";

    /// <summary>A step did not come: the picture a few frames on (the note on screen is drawn by then), then quit with 1.</summary>
    private void Fail(string why)
    {
        GD.PrintErr($"nettest: {why}");
        failed = why;
        Next("failing");
    }

    private void Write(bool ok, string why)
    {
        var link = ServerLink.I;
        var st = GameState.I;
        var (h, m) = st.Shown;
        var doc = new Dictionary<string, object?>
        {
            ["ok"] = ok,
            ["why"] = why,
            ["server"] = new Dictionary<string, object?>
            {
                ["url"] = link?.Server?.Url,
                ["port"] = link?.Server?.Port,
                ["own"] = link?.Server?.Own,
                ["pid"] = link?.Server?.Pid,
                ["log"] = link?.Server?.LogFile,
            },
            ["first_state_by_call"] = polled,
            ["first_state_by_push"] = pushed,
            ["push_linked"] = link?.Api?.Linked,
            ["pause"] = new Dictionary<string, object?> { ["server_paused"] = pausedSeen, ["push_held_while_paused"] = heldWhilePaused, ["server_unpaused"] = unpausedSeen, ["push_came_after"] = cameAfter },
            ["map"] = new Dictionary<string, object?> { ["url"] = link?.MapUrl, ["reports"] = link?.MapReports },
            ["tick"] = tick == null ? null : new Dictionary<string, object?> { ["advanced"] = tick.Advanced, ["clock"] = tick.Clock, ["where"] = tick.Where },
            ["store"] = new Dictionary<string, object?>
            {
                ["live"] = st.Live,
                ["day"] = st.Day,
                ["weekday"] = st.Weekday,
                ["hour"] = st.Hour,
                ["minute"] = st.Minute,
                ["hour_f"] = Math.Round(st.HourF, 4),
                ["shown"] = $"{h}:{m:00}",
                ["weather"] = st.Weather,
                ["food"] = st.Food,
                ["warmth"] = st.Warmth,
                ["sleep"] = st.Sleep,
                ["health"] = st.Health,
                ["money_c"] = st.Money,
                ["rent_paid"] = st.RentPaid,
                ["rent_price_c"] = st.RentPrice,
                ["pockets"] = st.Pockets,
                ["jobs"] = st.Jobs.Count,
            },
            ["events"] = events,
            ["seconds"] = at,
            ["state"] = st.Payload,
        };
        File.WriteAllText(Path.Combine(dir, "nettest.json"), JsonSerializer.Serialize(doc, new JsonSerializerOptions(Api.Json) { WriteIndented = true }));
    }
}

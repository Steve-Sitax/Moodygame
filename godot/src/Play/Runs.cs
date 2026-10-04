using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;

namespace Scheldemist.Play;

/// <summary>
/// A job's work as the server wrote it (api.ts CarryTask, WatchTask, DeliverTask), read from the job's raw `task`.
/// The other kinds (letters, mill, lamps) have their own parts and are not read here.
/// </summary>
public sealed record JobTask
{
    /// <summary>"carry", "watch" or "deliver".</summary>
    public string Kind { get; init; } = "";
    public string Goods { get; init; } = "";
    public int Count { get; init; } = 1;
    public string From { get; init; } = "";
    public string To { get; init; } = "";
    public string Post { get; init; } = "";
    public double DurationS { get; init; }
    public string Recipient { get; init; } = "";
    public string Twist { get; init; } = "none";
    public double? LimitS { get; init; }
    public Progress? Progress { get; init; }
    public bool Cart { get; init; }

    /// <summary>The job's task as a record, or null when it is of a kind not played here.</summary>
    public static JobTask? Of(Job j)
    {
        if (j.Task is not { ValueKind: JsonValueKind.Object } t) return null;
        if (!t.TryGetProperty("kind", out var k) || k.GetString() is not ("carry" or "watch" or "deliver")) return null;
        try
        {
            return t.Deserialize<JobTask>(Api.Json);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

/// <summary>What a run needs of the rest (runs.ts RunCtx).</summary>
public sealed class RunCtx
{
    public Action<string> Toast = _ => { };
    public Action<string, Vector3?> Sfx = (_, _) => { };
    public Action<Progress> Progress = _ => { };
    public Action<Report> Finish = _ => { };
    public Action<bool> ThickFog = _ => { };
}

/// <summary>How a kind of job plays in 3D (runs.ts Run). It reports engine facts when it ends; the server settles.</summary>
public interface IRun
{
    void Update(float dt);
    /// <summary>Job keys when the hands are empty (take a parcel, call the ship).</summary>
    List<Act> Actions();
    /// <summary>Job keys for what is carried (hand it over, fill your pockets).</summary>
    List<Act> CarryActions(Item item);
    /// <summary>The words for setting the carried item down here, when the job cares.</summary>
    string? PlaceLabel(Item item, float x, float z);
    void OnLifted(Item item);
    void OnPlaced(Item item);
    /// <summary>A carried item is gone (into the Schelde); why: what to say, null for the usual line.</summary>
    void OnLost(Item item, string? why = null);
    /// <summary>Where the job wants Jef now, for the pointer.</summary>
    Vector3? Goal();
    /// <summary>The task card: the title, then its lines.</summary>
    List<string> Hud();
    void Dispose(bool keepGoods = false);
}

public static class RunWords
{
    public const float ReachDrop = 2.2f;
    public const float ReachPerson = 2.6f;

    /// <summary>runs.ts bellIn: the time left to the bell in game minutes.</summary>
    public static string BellIn(double realSecs)
    {
        int m = Math.Max(1, (int)Math.Ceiling(Math.Max(0, realSecs) * ClockRate.GameMinPerRealS));
        return m < 60 ? $"{m} min" : $"{m / 60} h {m % 60:00} min";
    }

    public static string Cap(string s) => s.Length == 0 ? s : char.ToUpperInvariant(s[0]) + s[1..];
    public static float Dist(float ax, float az, float bx, float bz) => MathF.Sqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));
}

/// <summary>
/// Carry and deliver (runs.ts HaulRun). The goods are the server's: it lays them out at the place they are fetched
/// from; the run counts what is delivered, lost and sold. The employer who hands a parcel over is a person of the
/// town (Folk); the recipient waits at the place as a figure of people.glb. The people of the twists (the stranger
/// who buys, the foreman who watches, the thief who follows) are called from the town by the browser's walk-up
/// (game/walkup.ts): that is not ported, so those twists do not play yet.
/// </summary>
public sealed class HaulRun : IRun
{
    private readonly Job job;
    private readonly JobTask task;
    private readonly RunCtx ctx;
    private int delivered, lost, sold;
    private bool pocketed, brokenSeen, late, ended;
    private double t;
    /// <summary>Deliver: the parcel is still with the employer. Carry from the ship: the cargo is still aboard.</summary>
    private bool waitingHandover;
    private readonly List<(bool Broken, bool Heavy)> toLower = new();
    private sealed class Lowering
    {
        public Node3D Obj = null!;
        public Vector3 From;
        public (float X, float Z) To;
        public int I;
        public float T;
        public bool Broken, Heavy;
    }
    private readonly List<Lowering> lowering = new();
    private float lowerTimer;
    private readonly int count;
    private readonly MeshInstance3D? mark;
    private Folk.Figure? recipient;
    private readonly Spot? to, from;

    private bool IsCarry => task.Kind == "carry";
    private string Noun => GoodsRules.Of(task.Goods).One;
    private bool IsMine(Item it) => it.JobId == job.Id;
    /// <summary>A parcel travels in the pocket, not in the hands.</summary>
    private bool Pocketed => task.Kind == "deliver" && task.Goods == "parcel";
    private bool ParcelInPocket => Pocketed && GameState.I.Pockets.Any(p => p.JobId == job.Id);

    public HaulRun(Job job, JobTask task, RunCtx ctx)
    {
        this.job = job;
        this.task = task;
        this.ctx = ctx;
        count = IsCarry ? task.Count : 1;
        var p = task.Progress ?? new Progress();
        delivered = p.Delivered;
        lost = p.Lost;
        sold = p.Sold;
        int left = Math.Max(0, count - delivered - lost - sold);
        var flags = Enumerable.Range(0, left).Select(_ => (Broken: false, Heavy: false)).ToList();
        if (task.Twist == "broken_goods" && left > 0) flags[Math.Min(1, left - 1)] = (true, false);
        if (task.Twist == "heavy_load" && left > 0) flags[0] = (false, true);

        bool fromShip = IsCarry && task.From == "ship_gangway";
        bool employer = Folk.Present(job.EmployerNpc);
        waitingHandover = left > 0 && ((task.Kind == "deliver" && employer && !(Pocketed && ParcelInPocket)) || fromShip);
        if (fromShip) toLower.AddRange(flags);
        _ = LayOut(!fromShip && !waitingHandover, fromShip);

        to = Spots.Get(task.To);
        from = Spots.Get(task.From);
        if (IsCarry && to != null)
        {
            // the chalk ring at the goal (RingGeometry 0.9 to 1.05, 12 sides)
            mark = new MeshInstance3D
            {
                Name = "job_mark",
                Mesh = new TorusMesh { InnerRadius = 0.9f, OuterRadius = 1.05f, Rings = 12, RingSegments = 3, Material = Goods.I.Plain(0xbdb6a0) },
                Position = new Vector3(to.X, 0.02f, to.Z),
                Scale = new Vector3(1, 0.02f, 1),
            };
            Main.I.View.AddChild(mark);
        }
        if (task.Twist == "thick_fog") ctx.ThickFog(true);
    }

    private async System.Threading.Tasks.Task LayOut(bool lay, bool fromShip)
    {
        var have = await Goods.I.JobGoods(job.Id, lay);
        if (ended || have.Count == 0) return;
        if (fromShip) toLower.RemoveRange(0, Math.Min(toLower.Count, have.Count));
        if (waitingHandover && (!fromShip || toLower.Count == 0) && lowering.Count == 0) waitingHandover = false;
    }

    /// <summary>The deliver's recipient: a stand-in at the place (the mate on the Anna Maria's deck).</summary>
    private void MakeRecipient()
    {
        if (task.Kind != "deliver" || recipient != null || ended || to == null) return;
        float x = to.X, z = to.Z, y = 0;
        if (task.To == "ship_gangway")
        {
            // world/rijnkaai.ts RAMP: the head of the gangway, on the deck
            x = -42 - 0.6f;
            z = -3.0f - 1.0f;
            float g = Jef.I.GroundAt(x, z, 2.5f);
            y = float.IsFinite(g) ? g : 0;
        }
        recipient = Folk.MakeFigure("recipient", x, z, y);
        if (from != null) recipient.Face(from.X, from.Z);
    }

    private float RecipientDist(float x, float z) => recipient == null ? float.PositiveInfinity : RunWords.Dist(recipient.Position.X, recipient.Position.Z, x, z);
    private static Vector3 Chest(Folk.Figure f) => f.Position + new Vector3(0, 1.3f, 0);

    // ---- empty hands

    public List<Act> Actions()
    {
        var o = new List<Act>();
        if (ended) return o;
        float x = Jef.I.X, z = Jef.I.Z;
        if (ParcelInPocket)
        {
            if (recipient != null && RecipientDist(x, z) < RunWords.ReachPerson) o.Add(Act.At(Key.E, $"give the parcel to {task.Recipient}", Chest(recipient), GiveParcel));
            return o;
        }
        if (!waitingHandover) return o;
        if (task.Kind == "deliver")
        {
            var e = Folk.At(job.EmployerNpc);
            if (e != null && Folk.Dist(job.EmployerNpc, x, z) < RunWords.ReachPerson)
                o.Add(Act.At(Key.F, $"take the {Noun} from {Folk.NameOf(job.EmployerNpc, job.EmployerName)}", e.Value + new Vector3(0, 1.3f, 0), TakeParcel));
        }
        else if (toLower.Count > 0 && lowering.Count == 0 && Spots.Get("ship_gangway") is { } gw && RunWords.Dist(x, z, gw.X, gw.Z) < 5)
            o.Add(Act.AtGround(Key.F, "call up to the ship for the cargo", gw.X, gw.Z, CallShip));
        return o;
    }

    private void TakeParcel()
    {
        Folk.LookAt?.Invoke(job.EmployerNpc, Jef.I.X, Jef.I.Z);
        if (Pocketed)
        {
            // the parcel goes into the pocket; the server keeps it (pockets are engine state)
            var api = ServerLink.I?.Api;
            api?.Run(api.Handover(job.Id), GameState.I.Apply, e => ctx.Toast(e.Message));
        }
        else _ = Goods.I.Handover(job.Id);
        waitingHandover = false;
        ctx.Sfx("lift", null);
        string line = job.EmployerNpc switch
        {
            "tuur" => $"Tuur presses the {Noun} into your hands. \"Don't open it. Don't lose it. Don't talk.\"",
            "peeters" => "The widow counts it out to you. \"Signed for. It is on your head now, young man.\"",
            "sooi" => $"Sooi shoves it at you. \"For {task.Recipient}. Go.\"",
            _ => $"You take the {Noun}.",
        };
        ctx.Toast(line);
    }

    private void GiveParcel()
    {
        recipient?.Face(Jef.I.X, Jef.I.Z);
        ctx.Toast($"{RunWords.Cap(task.Recipient)} takes the parcel, weighs it in one hand, and turns away.");
        delivered++;
        Changed();
    }

    private void CallShip()
    {
        ctx.Toast("\"Ahoy, the kaai!\" A sailor leans over the rail and swings the cargo out on a rope.");
        Folk.LookAt?.Invoke("sailor", Jef.I.X, Jef.I.Z);
        lowerTimer = 0.5f;
    }

    // ---- carrying

    public List<Act> CarryActions(Item item)
    {
        var o = new List<Act>();
        if (ended || !IsMine(item)) return o;
        if (recipient != null && RecipientDist(Jef.I.X, Jef.I.Z) < RunWords.ReachPerson) o.Add(Act.At(Key.E, $"hand it to {task.Recipient}", Chest(recipient), () => HandIn(item)));
        if (item.Broken && !pocketed) o.Add(Act.Me(Key.F, "fill your pockets", Pocket));
        return o;
    }

    public string? PlaceLabel(Item item, float x, float z)
    {
        if (!IsCarry || !IsMine(item) || to == null) return null;
        return RunWords.Dist(x, z, to.X, to.Z) < RunWords.ReachDrop ? "set it down here" : null;
    }

    public void OnPlaced(Item item)
    {
        if (!IsCarry || !IsMine(item) || to == null) return;
        if (RunWords.Dist(item.X, item.Z, to.X, to.Z) >= RunWords.ReachDrop) return;
        // delivered: it now simply belongs to the employer, lying at his door
        Goods.I.Unjob(item);
        delivered++;
        Changed();
    }

    public void OnLost(Item item, string? why = null)
    {
        if (!IsMine(item)) return;
        lost++;
        string say = why ?? $"The {Noun} goes over the edge. The Schelde takes it.";
        if (say != "") ctx.Toast(say);
        Changed();
    }

    private void HandIn(Item item)
    {
        if (Goods.I.Carried == item) Goods.I.DropCarried("handed");
        recipient?.Face(Jef.I.X, Jef.I.Z);
        ctx.Toast($"{RunWords.Cap(task.Recipient)} takes it without a word and turns away.");
        delivered++;
        Changed();
    }

    private void Pocket()
    {
        pocketed = true;
        ctx.Sfx("coins", null);
        ctx.Toast("You fill your coat. Nobody saw. Or did they?");
    }

    public void OnLifted(Item item)
    {
        if (!IsMine(item)) return;
        if (item.Heavy)
        {
            Jef.I.SpeedFactor = 0.4f;
            ctx.Toast($"This {Noun} is far too heavy for one man. You stagger under it.");
        }
        if (item.Broken && !brokenSeen)
        {
            brokenSeen = true;
            ctx.Toast(GoodsRules.Of(task.Goods).Broken);
        }
    }

    private void Changed()
    {
        ctx.Progress(new Progress { Delivered = delivered, Lost = lost, Sold = sold });
        if (delivered + lost + sold >= count && !ended)
        {
            ended = true;
            ctx.Finish(new Report { Delivered = delivered, Lost = lost, Sold = sold, Pocketed = pocketed, Late = late });
        }
    }

    // ---- frame

    public void Update(float dt)
    {
        t += dt;
        if (task.LimitS is { } limit && limit > 0 && !late && t > limit)
        {
            late = true;
            ctx.Sfx("bell", null);
            ctx.Toast("A bell rings over the water. You are late.");
        }
        MakeRecipient();
        recipient?.Update(dt);

        // cargo swung down from the ship's rail, one at a time
        var gw = Spots.Get("ship_gangway");
        if (lowerTimer > 0 && gw != null)
        {
            lowerTimer -= dt;
            if (lowerTimer <= 0 && toLower.Count > 0)
            {
                var f = toLower[0];
                toLower.RemoveAt(0);
                int i = count - delivered - lost - sold - toLower.Count - 1;
                var obj = Goods.I.MakeGoods(task.Goods);
                var start = new Vector3(gw.X + 1.5f, 3.4f, -2.6f);
                obj.Position = start;
                Main.I.View.AddChild(obj);
                lowering.Add(new Lowering { Obj = obj, From = start, To = Spots.Slot(gw, i), I = i, Broken = f.Broken, Heavy = f.Heavy });
                if (toLower.Count > 0) lowerTimer = 2.2f;
            }
        }
        foreach (var l in lowering)
        {
            l.T += dt;
            float k = Math.Min(1, l.T / 2);
            float px = Mathf.Lerp(l.From.X, l.To.X, Math.Min(1, k * 1.6f));
            float pz = Mathf.Lerp(l.From.Z, l.To.Z, Math.Min(1, k * 1.6f));
            l.Obj.Position = new Vector3(px, Mathf.Lerp(l.From.Y, 0, k * k), pz);
            if (k >= 1)
            {
                l.Obj.QueueFree();
                // on the quay it is the server's (at the same slot); here when it answers
                _ = Goods.I.Lower(job.Id, l.I, l.Broken, l.Heavy);
                ctx.Sfx($"thud_{GoodsRules.Of(task.Goods).Thud}", new Vector3(l.To.X, 0, l.To.Z));
            }
        }
        lowering.RemoveAll(l => l.T >= 2);
        if (waitingHandover && IsCarry && toLower.Count == 0 && lowering.Count == 0) waitingHandover = false;
    }

    public Vector3? Goal()
    {
        if (ended || to == null) return null;
        var carried = Goods.I.Carried;
        if ((carried != null && IsMine(carried)) || ParcelInPocket) return recipient != null ? recipient.Position : new Vector3(to.X, 0, to.Z);
        if (waitingHandover)
        {
            if (task.Kind == "deliver") return Folk.At(job.EmployerNpc);
            return Spots.Get("ship_gangway") is { } gw ? new Vector3(gw.X, 0, gw.Z) : null;
        }
        Vector3? best = null;
        float bestD = float.PositiveInfinity;
        foreach (var it in Goods.I.Items)
        {
            if (!IsMine(it)) continue;
            float d = RunWords.Dist(Jef.I.X, Jef.I.Z, it.X, it.Z);
            if (d < bestD) (best, bestD) = (new Vector3(it.X, it.Y, it.Z), d);
        }
        return best;
    }

    public List<string> Hud()
    {
        var carried = Goods.I.Carried;
        bool mine = (carried != null && IsMine(carried)) || ParcelInPocket;
        string employer = Folk.NameOf(job.EmployerNpc, job.EmployerName);
        string toLabel = to?.Label ?? task.To, fromLabel = from?.Label ?? task.From;
        string step = mine
            ? task.Kind == "deliver" ? $"Bring it to {task.Recipient} at {toLabel}" : $"Bring it to {toLabel}"
            : waitingHandover
                ? task.Kind == "deliver" ? $"Get the {Noun} from {employer}" : "Ask the ship for the cargo at the gangway"
                : task.Cart ? $"Load the {Noun} on the handcart at {fromLabel}" : $"Fetch the {Noun} at {fromLabel}";
        var lines = new List<string> { job.Title, step };
        if (IsCarry) lines.Add($"{delivered} / {count} delivered{(lost > 0 ? $", {lost} lost" : "")}{(sold > 0 ? $", {sold} sold" : "")}");
        if (task.LimitS is { } limit && limit > 0) lines.Add(late ? "Late" : $"The bell in {RunWords.BellIn(limit - t)}");
        return lines;
    }

    public void Dispose(bool keepGoods = false)
    {
        ended = true;
        if (!keepGoods) Goods.I.ClearJob(job.Id);
        mark?.QueueFree();
        foreach (var l in lowering) l.Obj.QueueFree();
        lowering.Clear();
        recipient?.Remove();
        recipient = null;
        if (task.Twist == "thick_fog") ctx.ThickFog(false);
    }
}

/// <summary>
/// Stand guard at a post until the bell (runs.ts WatchRun). The thief, the man with the bribe and the employer's
/// man are townspeople called from where they are: they come with the townspeople's part. Until then the watch is
/// the post, the pile, the time away from it and the bell.
/// </summary>
public sealed class WatchRun : IRun
{
    private readonly Job job;
    private readonly JobTask task;
    private readonly RunCtx ctx;
    private readonly Spot post;
    private List<Item> pile = new();
    private double t, away;
    private bool ended, warnedAway;

    public WatchRun(Job job, JobTask task, RunCtx ctx)
    {
        this.job = job;
        this.task = task;
        this.ctx = ctx;
        post = Spots.Get(task.Post) ?? new Spot(task.Post, task.Post, Jef.I.X, Jef.I.Z, 1, 0);
        _ = LayOut();
        if (task.Twist == "thick_fog") ctx.ThickFog(true);
        ctx.Toast($"Stand by the {task.Goods} at {post.Label} until the bell.");
    }

    private async System.Threading.Tasks.Task LayOut()
    {
        // the three at the post are the server's (laid out once)
        var items = await Goods.I.JobGoods(job.Id, true);
        pile = items.Where(i => i.S.Lies).ToList();
    }

    private bool Near() => RunWords.Dist(Jef.I.X, Jef.I.Z, post.X, post.Z) < 7;

    public List<Act> Actions() => new();
    public List<Act> CarryActions(Item item) => new();
    public string? PlaceLabel(Item item, float x, float z) => null;
    public void OnLifted(Item item) { }
    public void OnPlaced(Item item) { }
    public void OnLost(Item item, string? why = null) { }

    public void Update(float dt)
    {
        if (ended) return;
        t += dt;
        if (!Near())
        {
            away += dt;
            if (!warnedAway && away > 5)
            {
                warnedAway = true;
                ctx.Toast("You are away from your post.");
            }
        }
        else warnedAway = false;
        if (t >= task.DurationS)
        {
            ended = true;
            ctx.Sfx("bell", null);
            ctx.Toast("The bell. Your watch is over.");
            ctx.Finish(new Report { LeftPostS = Math.Round(away), Thief = "none", BribeTaken = false, SeenAway = false });
        }
    }

    public Vector3? Goal() => ended || Near() ? null : new Vector3(post.X, 0, post.Z);

    public List<string> Hud() => new()
    {
        job.Title,
        $"Stand watch at {post.Label}",
        Near() ? $"The bell in {RunWords.BellIn(task.DurationS - t)}" : "Back to your post!",
    };

    public void Dispose(bool keepGoods = false)
    {
        ended = true;
        // the goods stay; they are the employer's, no longer part of a job
        Goods.I.ClearJob(job.Id);
        if (task.Twist == "thick_fog") ctx.ThickFog(false);
    }
}

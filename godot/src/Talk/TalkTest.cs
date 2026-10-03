using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Windows;

namespace Scheldemist.Talks;

/// <summary>
/// The talk part's own test: `-- --talktest dir --no-ai`. Against the game's own server with no model calls it
/// opens each window by script, presses its keys through the game's real input (a choice, a purchase, the pockets,
/// a page), saves a picture of each to dir and what the server answered to dir/talktest.json, and quits; 1 and the
/// reason in the json when a step does not come. Without --no-ai it refuses to run, except as
/// `--talktest dir --talktest-ai`: one talk with a typed line, to prove the reply of a model shows (two model
/// calls: the opening line and the answer).
/// </summary>
[GamePart(210)]
public partial class TalkTest : Node
{
    private string dir = "";
    private readonly Dictionary<string, object?> doc = new();
    private readonly List<Dictionary<string, object?>> steps = new();
    private readonly List<string> said = new();
    private readonly List<string> pictures = new();

    public override void _Ready()
    {
        dir = Main.I.Arg("talktest");
        if (dir == "") return;
        Directory.CreateDirectory(dir);
        GameState.I.Message += m => said.Add(m);
        _ = Run();
    }

    private async Task Run()
    {
        bool ok = false;
        string why = "";
        try
        {
            bool ai = Main.I.Flag("talktest-ai");
            if (!ai && !Main.I.Flag("no-ai")) throw new InvalidOperationException("--talktest needs --no-ai (no model calls), or --talktest-ai for the one talk with a model");
            if (ai && Main.I.Flag("no-ai")) throw new InvalidOperationException("--talktest-ai with --no-ai: there is no model to answer");
            if (ServerLink.I is not { } link) throw new InvalidOperationException("the server link is off");
            if (!await Until(() => (link.Up && GameState.I.Live) || link.Error != "", 100)) throw new TimeoutException("no first state from the server in 100 s");
            if (link.Error != "") throw new InvalidOperationException(link.Error);
            var api = link.Api!;
            doc["server"] = new Dictionary<string, object?> { ["url"] = link.Server?.Url, ["port"] = link.Server?.Port, ["pid"] = link.Server?.Pid, ["own"] = link.Server?.Own };
            doc["ai"] = await Try(() => api.Get<JsonElement>("api/ai/config"));
            // a new game opens on the ferry; ashore, a clear morning with the shops and counters open, needs full
            await Try(() => api.Post<JsonElement>("api/arrival/ashore"));
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { hour = 9, minute = 0, weather = "clear", food = 6, warmth = 10, sleep = 10, health = 10 }));
            await Frames(30);
            if (ai) await WithModel(api);
            else await NoModel(api);
            ok = steps.All(s => s["ok"] is true);
            if (!ok) why = "steps failed: " + string.Join(", ", steps.Where(s => s["ok"] is not true).Select(s => s["step"]));
        }
        catch (Exception e)
        {
            why = e.Message;
            GD.PrintErr($"talktest: {e}");
            await Frames(10);
            Save("failed");
        }
        doc["ok"] = ok;
        doc["why"] = why;
        doc["steps"] = steps;
        doc["said"] = said;
        doc["pictures"] = pictures;
        doc["dialogs_left_up"] = Dialogs.I?.Up;
        File.WriteAllText(Path.Combine(dir, Main.I.Flag("talktest-ai") ? "talktest-ai.json" : "talktest.json"), JsonSerializer.Serialize(doc, new JsonSerializerOptions(Api.Json) { WriteIndented = true }));
        GetTree().Quit(ok ? 0 : 1);
    }

    // ------------------------------------------------------------------ the run with no model

    private async Task NoModel(Api api)
    {
        var dialogs = Dialogs.I!;
        var talk = Talk.I!;
        var shops = await Shop.I!.List();
        var open = shops.FirstOrDefault(s => s.Open && s.Keeper != null && s.Trade == "publican") ?? shops.FirstOrDefault(s => s.Open && s.Keeper != null);
        doc["shops"] = shops.Select(s => new { s.Place, s.Label, s.Open, keeper = s.Keeper?.Name }).ToList();
        if (open == null) throw new InvalidOperationException("no shop is open at 9:00");
        var keeper = open.Keeper!;

        // 1. the dialog base: a talk, a page on top of it, Esc and E, the mouse, a key that must not pass
        var before = Input.MouseMode;
        Input.MouseMode = Input.MouseModeEnum.Captured;
        talk.Open(keeper.Id, keeper.Name, open.Trade);
        await Shot("talk_wait");
        bool answered = await Until(() => !talk.Busy, 30);
        Step("talk opens", answered && talk.IsOpen && talk.Lines.Count > 0, new { with = keeper.Name, reply = talk.LastReply, up = dialogs.Up, mouse = Input.MouseMode.ToString() });
        await Shot("talk");
        bool freed = Input.MouseMode == Input.MouseModeEnum.Visible;
        await Press.I!.OpenBerg();
        await Frames(4);
        var both = dialogs.Up.ToList();
        await Shot("stack_page_over_talk");
        await Key(Godot.Key.Escape);
        var afterEsc = dialogs.Up.ToList();
        // a key of the talk while the page was on top must not have reached it: 1 would have picked an answer
        await Press.I.OpenBerg();
        await Frames(4);
        int linesBefore = talk.Lines.Count;
        await Key(Godot.Key.B); // B is the talk's "buy": the page on top has no such key
        bool talkQuiet = !talk.Shopping && talk.Lines.Count == linesBefore;
        await Key(Godot.Key.E);
        var afterE = dialogs.Up.ToList();
        Step("dialog stack", both.SequenceEqual(new[] { "talk", "press page" }) && afterEsc.SequenceEqual(new[] { "talk" }) && afterE.SequenceEqual(new[] { "talk" }) && talkQuiet && freed,
            new { both, afterEsc, afterE, talkQuiet, mouseFreed = freed });

        // 2. a choice by its number key, the answer; T with no AI
        var choices = talk.Choices.ToList();
        await Key(Godot.Key.Key1);
        answered = await Until(() => !talk.Busy, 30);
        await Shot("talk_choice");
        Step("choice 1", answered && talk.Lines.Count >= 3, new { picked = choices.FirstOrDefault(), reply = talk.LastReply, lines = talk.Lines.Select(l => $"{l.Who}: {l.Text}") });
        // T with no AI: in an ordinary talk the line can still be typed and the server answers with a hand-written
        // line (no model call); only where it says free: false (a confrontation, the police) is typing off
        int had = talk.Lines.Count;
        await Key(Godot.Key.T);
        await Frames(4);
        bool couldType = talk.Typing;
        talk.DevType("Good morning to you.");
        await Shot("talk_typing");
        await Key(Godot.Key.Enter);
        await Frames(2);
        answered = await Until(() => !talk.Busy, 30);
        await Shot("talk_typed_no_ai");
        Step("a typed line with no AI", couldType && answered && !talk.Typing && (talk.Lines.Count == had + 2 || talk.Note != ""), new { couldType, note = talk.Note, reply = talk.LastReply });
        await Until(() => talk.Note == "", 4);

        // 3. the wares (B), a purchase (1), the haggle's picker (H), back
        await Key(Godot.Key.B);
        await Frames(20);
        await Shot("shop");
        int money = GameState.I.Money;
        int things = GameState.I.Pockets.Count;
        await Key(Godot.Key.Key1);
        bool paid = await Until(() => talk.Note.StartsWith("Paid", StringComparison.Ordinal) || talk.Note != "", 10);
        await Shot("shop_bought");
        Step("buy 1", paid && talk.Note.StartsWith("Paid", StringComparison.Ordinal) && GameState.I.Money < money, new { note = talk.Note, moneyBefore = money, moneyAfter = GameState.I.Money, pocketsBefore = things, pocketsAfter = GameState.I.Pockets.Count });
        await Until(() => talk.Note == "", 4);
        await Key(Godot.Key.H);
        await Shot("shop_haggle_pick");
        // which ware (1), his argument typed, the seller's answer (hand-written with no AI; the engine keeps the price)
        had = talk.Lines.Count;
        await Key(Godot.Key.Key1);
        await Frames(4);
        bool arguing = talk.Typing;
        await Seconds(5.2); // the server's gate takes one typed line in five seconds
        talk.DevType("Yesterday's bake, friend. Four centimes and we are both content.");
        await Shot("shop_haggle_typing");
        await Key(Godot.Key.Enter);
        await Frames(2);
        answered = await Until(() => !talk.Busy, 30);
        await Shot("shop_haggle_reply");
        Step("argue a price (H, 1, a typed line)", arguing && answered && talk.Lines.Count == had + 2, new { note = talk.Note, reply = talk.LastReply });
        await Key(Godot.Key.E);
        bool closed = !talk.IsOpen && !dialogs.Any;
        Step("E steps away, the mouse is taken again", closed && Input.MouseMode == Input.MouseModeEnum.Captured, new { up = dialogs.Up, mouse = Input.MouseMode.ToString() });
        Input.MouseMode = before;

        // the shop by its place, straight on the list
        bool shopOpen = await Shop.I.Open(open.Place);
        await Frames(20);
        await Shot("shop_by_place");
        Step("Shop.Open(place)", shopOpen && talk.IsOpen && talk.Shopping, new { open.Place, with = talk.With });
        talk.Close();

        // 4. work offered in a talk: W, then 1 takes it
        talk.Open("sooi", "Sooi");
        await Until(() => !talk.Busy, 30);
        await Shot("talk_sooi");
        await Key(Godot.Key.W);
        await Shot("talk_work");
        int taken = GameState.I.Jobs.Count(j => j.Status == "taken");
        await Key(Godot.Key.Key1);
        bool took = await Until(() => GameState.I.Jobs.Count(j => j.Status == "taken") > taken, 10);
        Step("take work (W, 1)", took && !talk.IsOpen, new { jobs = GameState.I.Jobs.Where(j => j.Status == "taken").Select(j => j.Title) });

        // 5. Fientje's herring, then the pockets: I, a picture, 1 eats it
        Shop.I.OpenAt("fientje", "Fientje");
        await Frames(20);
        money = GameState.I.Money;
        await Key(Godot.Key.Key1);
        await Until(() => talk.Note != "", 10);
        await Shot("shop_fientje");
        Step("buy a herring", GameState.I.Pockets.Any(p => p.Kind == "herring"), new { note = talk.Note, moneyBefore = money, moneyAfter = GameState.I.Money });
        await Key(Godot.Key.E);

        // the paper from a newsboy, a pledge at the Berg, a letter: things to read in the pockets
        string? boy = Press.I.Info?.Corners?.FirstOrDefault()?.Boy;
        doc["press"] = Press.I.Info;
        if (boy != null) doc["paper_bought"] = await Try(() => api.Post<ShopBuyReply>("api/buy", new { npc = boy, kind = "newspaper" }), r => GameState.I.Apply(r));
        await Press.I.OpenBerg();
        await Frames(6);
        await Shot("berg");
        bool bergUp = Press.I.Page == "berg";
        await Key(Godot.Key.Key1);
        bool pawned = await Until(() => GameState.I.Pockets.Any(p => p.Kind == "pawn_ticket"), 8);
        await Frames(6);
        await Shot("berg_pawned");
        Step("the Berg: pawn (1)", bergUp && pawned, new { text = Press.I.LastText, money = GameState.I.Money });
        await Key(Godot.Key.E);
        await Press.I.OpenPost();
        await Frames(6);
        await Shot("post");
        Step("the post counter", Press.I.Page == "post", new { });
        await Key(Godot.Key.Escape);
        doc["letter_made"] = await Try(() => api.Post<JsonElement>("api/dev/press", new { letter = true }, 30_000));
        GameState.I.Apply(await api.Jobs());
        await Frames(4);

        food = GameState.I.Food;
        await Key(Godot.Key.I);
        await Frames(20); // his name in the town comes with it
        await Shot("pockets");
        var inPockets = GameState.I.Pockets.Select(p => $"{p.Name} ({p.Use ?? p.Note})").ToList();
        Step("pockets (I)", Pockets.I!.IsOpen && dialogs.Up.SequenceEqual(new[] { "pockets" }), new { inPockets });
        int herring = GameState.I.Pockets.ToList().FindIndex(p => p.Kind == "herring");
        if (herring >= 0)
        {
            await Key(Godot.Key.Key1 + herring);
            bool ate = await Until(() => Pockets.I.LastUse != "", 8);
            await Frames(20);
            await Shot("pockets_ate");
            Step("eat from the pockets", ate && !Pockets.I.IsOpen && GameState.I.Food > food, new { answer = Pockets.I.LastUse, foodBefore = food, foodAfter = GameState.I.Food });
        }
        else Step("eat from the pockets", false, new { why = "no herring" });

        // 6. the papers, each read from its pocket by I and its number
        foreach (var (kind, name) in new[] { ("newspaper", "paper"), ("letter", "letter"), ("pawn_ticket", "ticket") })
        {
            int at = GameState.I.Pockets.ToList().FindIndex(p => p.Kind == kind && p.Use == "read");
            if (at < 0)
            {
                Step($"read the {name}", false, new { why = "not in the pockets" });
                continue;
            }
            await Key(Godot.Key.I);
            await Key(Godot.Key.Key1 + at);
            bool up = await Until(() => Press.I.Page == name, 8);
            await Frames(8);
            await Shot(name);
            Step($"read the {name}", up, new { pocket = at + 1 });
            await Key(Godot.Key.E);
        }
        var bills = await Press.I.Bills();
        doc["bills"] = bills.Select(b => new { b.Id, b.Kind, b.Text.Heading }).ToList();
        if (bills.Count > 0)
        {
            bool up = await Press.I.OpenBill(bills[0].Id);
            await Frames(8);
            await Shot("bill");
            Step("a bill read large", up && Press.I.Page == "bill", new { bills[0].Text.Heading });
            await Key(Godot.Key.Escape);
        }
        else Step("a bill read large", false, new { why = "no bills up" });

        // 7. a speech bubble over a point in the world, and one that follows the server's push shape
        var cam = Main.I.Cam;
        var ahead = cam.GlobalPosition - cam.GlobalBasis.Z * 4 + Vector3.Down * 0.2f;
        var voices = new List<string>();
        Bubbles.I!.Speak = (at, sex, age, seconds) => voices.Add(FormattableString.Invariant($"{sex} {age} for {seconds:0.0} s at {at.X:0.0}, {at.Z:0.0}"));
        Bubbles.I.Say(() => ahead, "Pol", "Handelsblad, five centimes! Today in the town!");
        var feet = cam.GlobalPosition - cam.GlobalBasis.Z * 6 + cam.GlobalBasis.X * 2.5f;
        feet.Y = cam.GlobalPosition.Y - 1.62f;
        Bubbles.I.Show(new Convo { Id = 900001, A = "a", B = "b", AName = "Mie", BName = "Stien", Lines = new() { new ConvoLine { Who = "a", Name = "Mie", Text = "They say the mail steamer for Harwich sails at six, and half the Werf will be down to see it off." }, new ConvoLine { Who = "b", Name = "Stien", Text = "Let them. I have fish to sell." } } }, () => feet);
        await Seconds(0.6); // the tags fade in over 0.2 s
        await Shot("bubbles");
        var up1 = Bubbles.I.Info().Where(b => b.Id == 900001 || b.Id <= -1_000_000).ToList();
        Step("speech bubbles", up1.Count == 2 && up1.All(b => b.On) && voices.Count >= 2, new { up = up1.Select(b => new { b.Id, b.Line, b.Of, b.On }), voices, shown = Bubbles.I.Shown });
        await Until(() => Bubbles.I.Active == 0, 12);
        Step("bubbles go by themselves", Bubbles.I.Active == 0, new { shown = Bubbles.I.Shown });

        // 8. the dice panel (the panel as given: sitting down needs a tavern and its patron)
        Dice.I!.Show("tavern:test", keeper.Id, keeper.First, "The cup is yours. What do you put down?", new[] { 5, 10, 25 }, new DiceLeft { Games = 3, LossC = 50 }, GameState.I.Money);
        await Frames(6);
        await Shot("dice");
        await Key(Godot.Key.Key1);
        bool thrown = await Until(() => !Dice.I.Busy && Dice.I.Line != "The cup is yours. What do you put down?", 10);
        await Frames(6);
        await Shot("dice_thrown");
        Step("the dice", Dice.I.IsOpen && thrown, new { answer = Dice.I.Line });
        await Key(Godot.Key.E);
        Step("all closed", !dialogs.Any, new { up = dialogs.Up });
    }

    private double food;

    // ------------------------------------------------------------------ the run with a model (two calls)

    private async Task WithModel(Api api)
    {
        var talk = Talk.I!;
        talk.Open("fientje", "Fientje");
        await Shot("ai_wait");
        bool answered = await Until(() => !talk.Busy, 40);
        await Shot("ai_open");
        Step("the opening line", answered && talk.Lines.Count > 0, new { reply = talk.LastReply });
        bool free = talk.LastReply?.Free != false;
        await Key(Godot.Key.T);
        await Frames(4);
        const string typed = "Good morning. Is the herring fresh today, or is it yesterday's?";
        talk.DevType(typed);
        await Shot("ai_typing");
        bool typing = talk.Typing;
        await Key(Godot.Key.Enter);
        await Frames(4);
        await Shot("ai_typed_wait");
        answered = await Until(() => !talk.Busy, 40);
        await Frames(4);
        await Shot("ai_typed_reply");
        Step("a typed line and its reply", free && typing && answered && talk.Lines.Count >= 3 && talk.LastReply?.Gated == null, new { typed, reply = talk.LastReply, lines = talk.Lines.Select(l => $"{l.Who}: {l.Text}") });
        talk.Close();
        doc["ai_after"] = await Try(() => api.Get<JsonElement>("api/ai/config"));
    }

    // ------------------------------------------------------------------ helpers

    private void Step(string name, bool ok, object what)
    {
        steps.Add(new Dictionary<string, object?> { ["step"] = name, ["ok"] = ok, ["what"] = what });
        GD.Print($"talktest: {(ok ? "ok  " : "FAIL")} {name}");
    }

    private async Task<object?> Try<T>(Func<Task<T>> call, Action<T>? then = null)
    {
        try
        {
            var r = await call();
            then?.Invoke(r);
            return r;
        }
        catch (ApiException e)
        {
            return new { error = e.Message, status = e.Status };
        }
    }

    private async Task Frames(int n)
    {
        for (int i = 0; i < n; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
    }

    private async Task Seconds(double s)
    {
        ulong end = Time.GetTicksMsec() + (ulong)(s * 1000);
        while (Time.GetTicksMsec() < end) await Frames(1);
    }

    private async Task<bool> Until(Func<bool> cond, double seconds)
    {
        ulong end = Time.GetTicksMsec() + (ulong)(seconds * 1000);
        while (Time.GetTicksMsec() < end)
        {
            if (cond()) return true;
            await Frames(1);
        }
        return cond();
    }

    /// <summary>A key through the game's real input, down and up, as the keyboard sends it.</summary>
    private async Task Key(Key k)
    {
        Input.ParseInputEvent(new InputEventKey { PhysicalKeycode = k, Keycode = k, Pressed = true });
        await Frames(2);
        Input.ParseInputEvent(new InputEventKey { PhysicalKeycode = k, Keycode = k, Pressed = false });
        await Frames(3);
    }

    private async Task Shot(string name)
    {
        await Frames(6);
        Save(name);
    }

    private void Save(string name)
    {
        string f = Path.Combine(dir, $"godot_{name}.png");
        GetViewport().GetTexture().GetImage().SavePng(f);
        pictures.Add(f);
    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Godot;
using Scheldemist.Game;
using Scheldemist.Player;

namespace Scheldemist.Play;

/// <summary>
/// One thing a key can do now (game/runs.ts Action): the key, the words of the prompt, what it does. It is about a
/// point in the world (`At`: offered only while Jef looks at it) or about Jef himself and the spot ahead (`Self`).
/// </summary>
public sealed class Act
{
    public Key Key = Key.E;
    public string Text = "";
    public Action Run = () => { };
    /// <summary>What it is about: x and z on the map; Y when the height is known (a person's chest, a door's middle).</summary>
    public float X, Z;
    public float? Y;
    /// <summary>About Jef himself or the spot ahead: no looking needed.</summary>
    public bool Self;
    /// <summary>A wider cone than the usual, in degrees (the thief who just robbed you).</summary>
    public float? Cone;

    public static Act At(Key key, string text, Vector3 at, Action run, float? cone = null) => new() { Key = key, Text = text, Run = run, X = at.X, Y = at.Y, Z = at.Z, Cone = cone };
    public static Act AtGround(Key key, string text, float x, float z, Action run) => new() { Key = key, Text = text, Run = run, X = x, Z = z };
    public static Act Me(Key key, string text, Action run) => new() { Key = key, Text = text, Run = run, Self = true };
}

/// <summary>What one part offers now (jobs.ts findAll takes them in this order).</summary>
public sealed class Offers
{
    /// <summary>Only these keys, nothing else of anyone (carrying goods, on a velocipede).</summary>
    public List<Act>? Only;
    /// <summary>Keys of the job in hand: offered before the rest, each when in view.</summary>
    public List<Act>? First;
    /// <summary>Things E could go to, each with its distance (or a priority): of all parts' options, the one nearest the crosshair wins.</summary>
    public List<(float D, Act A)>? Options;
    /// <summary>More keys (F to buy, F to pay the rent): each when in view and its key still free.</summary>
    public List<Act>? Extra;
}

/// <summary>
/// The prompt (deliverable of game/jobs.ts findActions, game/facing.ts): what Jef looks at within reach gets the
/// browser's prompt line ("E  read the hiring board"), and the key does it. Other parts add to it:
///
///   Interact.I.Add(node, 2.6f, "read the hiring board", OpenBoard);            a thing: its middle is looked at
///   Interact.I.Add(new Vector3(x, 1.5f, z), 2.4f, () => "sleep here", Sleep);  a place, a label that changes
///   Interact.I.AddProvider((x, z) => new Offers { ... });                      a part with its own rules
///   Interact.I.Shut.Add(() => windowOpen);                                     no keys while a paper is up
///
/// The browser's rules for which thing wins (facing.ts): a thing is offered only in a cone of 35 degrees in front
/// (50 within 1.2 m; any direction within 0.45 m) and 45 degrees up or down (60 close); of several, the lowest
/// distance + 0.3 m per degree off the crosshair; one line a key, the first to claim a key keeps it.
/// The list is found ten times a second, or at once when Jef moved or turned; asked afresh for the key pressed.
/// </summary>
[GamePart(60)]
public partial class Interact : Node
{
    public static Interact I { get; private set; } = null!;

    // facing.ts
    private const float Deg = MathF.PI / 180;
    private const float ConeFar = 35 * Deg, ConeClose = 50 * Deg, Close = 1.2f, OnTop = 0.45f;
    private const float Tilt = 45 * Deg, TiltClose = 60 * Deg;
    private const float PerRad = 0.3f / Deg;

    /// <summary>A thing added with Add: taken away again with Remove (or Dispose).</summary>
    public sealed class Entry : IDisposable
    {
        public Node3D? Node;
        public Vector3 Place;
        public float Reach;
        public Key Key = Key.E;
        public Func<string?> Label = () => null;
        public Action Run = () => { };
        /// <summary>Lower wins a tie against other things as near (the browser gives a thief -20).</summary>
        public float Priority;
        internal readonly Act Prompt = new();
        public Vector3 At => Node != null && GodotObject.IsInstanceValid(Node) ? Node.GlobalPosition + Place : Place;
        public void Dispose() => I?.Remove(this);
    }

    private readonly List<Entry> entries = new();
    private readonly List<Func<float, float, Offers?>> providers = new();
    /// <summary>A window is up (the board, the talk, the pockets, a sheet): no keys, no prompt.</summary>
    public List<Func<bool>> Shut { get; } = new();
    /// <summary>The keys offered now, as the prompt shows them.</summary>
    public IReadOnlyList<Act> Acts => acts;
    /// <summary>The prompt's words now ("E  lift the crate"), for the checks.</summary>
    public string Text { get; private set; } = "";

    private List<Act> acts = new();
    private readonly List<Act> scratchActs = new(4);
    private readonly List<Offers> scratchOffers = new(32);
    private readonly List<Key> optionKeys = new(4);
    private readonly Dictionary<Key, (float Rank, Act Act)> bestByKey = new(4);
    private readonly StringBuilder prompt = new(256);
    private readonly List<(Key Key, string Name, string Text)> promptLines = new(4);
    private Label label = null!;
    private float uiScale;
    private double actsT;
    private Vector3 actsAt = new(float.NaN, 0, 0);
    private bool actsShut;

    public Interact()
    {
        I = this;
    }

    // ------------------------------------------------------------------ adding

    /// <summary>A thing at a node: `at` is where to look, from the node's own place (a door's middle is 1 m up).</summary>
    public Entry Add(Node3D node, float reach, string label, Action action, Key key = Key.E, Vector3? at = null) =>
        Add(new Entry { Node = node, Place = at ?? Vector3.Zero, Reach = reach, Label = () => label, Run = action, Key = key });

    /// <summary>A place in the world (its height is looked at too).</summary>
    public Entry Add(Vector3 place, float reach, string label, Action action, Key key = Key.E) =>
        Add(new Entry { Place = place, Reach = reach, Label = () => label, Run = action, Key = key });

    /// <summary>A label that changes ("open the door" / "close the door"); null: not offered now.</summary>
    public Entry Add(Vector3 place, float reach, Func<string?> label, Action action, Key key = Key.E) =>
        Add(new Entry { Place = place, Reach = reach, Label = label, Run = action, Key = key });

    public Entry Add(Entry e)
    {
        entries.Add(e);
        actsT = 0;
        return e;
    }

    public void Remove(Entry e)
    {
        entries.Remove(e);
        actsT = 0;
    }

    /// <summary>A part with rules of its own: asked with Jef's place each time the keys are found.</summary>
    public void AddProvider(Func<float, float, Offers?> f) => providers.Add(f);

    // ------------------------------------------------------------------ facing.ts

    /// <summary>How far off the crosshair a point is (radians), or null when it is out of view. y: its height when known.</summary>
    public static float? Aim(float x, float? y, float z, float? cone = null)
    {
        var jef = Jef.I;
        if (jef == null) return 0;
        var eye = jef.Cam.GlobalPosition;
        float dx = x - eye.X, dz = z - eye.Z;
        float h = MathF.Sqrt(dx * dx + dz * dz);
        bool close = h < Close;
        float off = 0;
        if (h > OnTop)
        {
            float fx = -MathF.Sin(jef.Yaw), fz = -MathF.Cos(jef.Yaw);
            off = MathF.Acos(Math.Clamp((dx * fx + dz * fz) / h, -1, 1));
            float lim = close ? ConeClose : ConeFar;
            if (cone != null) lim = Math.Max(cone.Value * Deg, lim);
            if (off > lim) return null;
        }
        if (y != null)
        {
            float up = MathF.Atan2(y.Value - eye.Y, Math.Max(h, 0.05f));
            float tilt = MathF.Abs(up - jef.Pitch);
            if (tilt > (close ? TiltClose : Tilt)) return null;
            // looking well above or below counts a little against it too
            off += Math.Max(0, tilt - 15 * Deg) * 0.5f;
        }
        return off;
    }

    public static bool InView(Act a) => a.Self || Aim(a.X, a.Y, a.Z, a.Cone) != null;

    /// <summary>Its rank among options (lower first), or null when out of view.</summary>
    public static float? Rank(Act a, float d)
    {
        if (a.Self) return d;
        float? off = Aim(a.X, a.Y, a.Z, a.Cone);
        return off == null ? null : d + off.Value * PerRad;
    }

    /// <summary>The best of the options: in view, nearest the crosshair.</summary>
    public static Act? Best(IEnumerable<(float D, Act A)> options)
    {
        Act? top = null;
        float bs = float.PositiveInfinity;
        foreach (var (d, a) in options)
        {
            float? s = Rank(a, d);
            if (s != null && s.Value < bs) (top, bs) = (a, s.Value);
        }
        return top;
    }

    // ------------------------------------------------------------------ finding (jobs.ts findAll)

    private readonly bool menus = Scheldemist.Menu.MainMenu.Wanted(Main.I);
    /// <summary>No keys of the hands now: a window is up (the dialogs' stack, the map), or the menus have the game.</summary>
    public bool IsShut => Scheldemist.Windows.Dialogs.I is { Any: true } || Scheldemist.Game.TownMap.I is { Open: true } || (menus && Scheldemist.Menu.MainMenu.I is { Entered: false }) || Shut.Any(f => f());

    /// <summary>Everything the keys can do right now, most specific first.</summary>
    public List<Act> Find()
        => Scheldemist.Dev.SpeedComparison.Cached ? FindCached(new List<Act>(4)) : FindOriginal();

    private List<Act> FindOriginal()
    {
        var found = new List<Act>();
        var jef = Jef.I;
        if (jef == null || jef.Fly || IsShut) return found;
        float x = jef.X, z = jef.Z;
        void Take(Act a)
        {
            if (!found.Any(o => o.Key == a.Key) && InView(a)) found.Add(a);
        }
        var more = new List<Offers>();
        foreach (var f in providers)
        {
            var o = f(x, z);
            if (o != null) more.Add(o);
        }
        var only = more.FirstOrDefault(m => m.Only != null)?.Only;
        if (only != null)
        {
            foreach (var a in only) Take(a);
            return found;
        }
        foreach (var m in more)
            if (m.First != null)
                foreach (var a in m.First)
                    Take(a);
        // E (or an entry's own key) goes to what Jef looks at, nearest the crosshair
        var byKey = new Dictionary<Key, List<(float, Act)>>();
        void Option(float d, Act a)
        {
            if (!byKey.TryGetValue(a.Key, out var l)) byKey[a.Key] = l = new List<(float, Act)>();
            l.Add((d, a));
        }
        foreach (var e in entries)
        {
            var at = e.At;
            float d = MathF.Sqrt((at.X - x) * (at.X - x) + (at.Z - z) * (at.Z - z));
            if (d >= e.Reach) continue;
            string? text = e.Label();
            if (string.IsNullOrEmpty(text)) continue;
            Option(d + e.Priority, new Act { Key = e.Key, Text = text, Run = e.Run, X = at.X, Y = at.Y, Z = at.Z });
        }
        foreach (var m in more)
            if (m.Options != null)
                foreach (var (d, a) in m.Options)
                    Option(d, a);
        foreach (var kv in byKey.OrderBy(k => k.Key == Key.E ? 0 : 1))
        {
            var top = Best(kv.Value);
            if (top != null) Take(top);
        }
        foreach (var m in more)
            if (m.Extra != null)
                foreach (var a in m.Extra)
                    Take(a);
        return found;
    }

    private static void Take(List<Act> found, Act a)
    {
        foreach (var old in found) if (old.Key == a.Key) return;
        if (InView(a)) found.Add(a);
    }
    private void Option(float distance, Act act)
    {
        // Preserve key insertion order even when its first option is out of view.
        if (!optionKeys.Contains(act.Key)) optionKeys.Add(act.Key);
        if (Rank(act, distance) is not { } rank || !(rank < float.PositiveInfinity)) return;
        if (!bestByKey.TryGetValue(act.Key, out var old) || rank < old.Rank) bestByKey[act.Key] = (rank, act);
    }
    private List<Act> FindCached(List<Act> found, bool borrowEntries = false)
    {
        using var cost = Scheldemist.Dev.FrameCost.Track("Interact.Find");
        found.Clear(); scratchOffers.Clear(); optionKeys.Clear(); bestByKey.Clear();
        var jef = Jef.I;
        if (jef == null || jef.Fly || IsShut) return found;
        float x = jef.X, z = jef.Z;
        foreach (var provider in providers)
        {
            using var callbackCost = Scheldemist.Dev.FrameCost.Callback(provider);
            if (provider(x, z) is { } offers) scratchOffers.Add(offers);
        }
        foreach (var offers in scratchOffers)
            if (offers.Only != null) { foreach (var act in offers.Only) Take(found, act); return found; }
        foreach (var offers in scratchOffers)
            if (offers.First != null) foreach (var act in offers.First) Take(found, act);
        foreach (var e in entries)
        {
            var at = e.At;
            float d = MathF.Sqrt((at.X - x) * (at.X - x) + (at.Z - z) * (at.Z - z));
            if (d >= e.Reach) continue;
            string? text = e.Label();
            if (string.IsNullOrEmpty(text)) continue;
            var act = borrowEntries ? e.Prompt : new Act();
            act.Key = e.Key; act.Text = text; act.Run = e.Run; act.X = at.X; act.Y = at.Y; act.Z = at.Z;
            act.Self = false; act.Cone = null;
            Option(d + e.Priority, act);
        }
        foreach (var offers in scratchOffers)
            if (offers.Options != null) foreach (var (distance, act) in offers.Options) Option(distance, act);
        if (bestByKey.TryGetValue(Key.E, out var first)) Take(found, first.Act);
        foreach (var key in optionKeys) if (key != Key.E && bestByKey.TryGetValue(key, out var best)) Take(found, best.Act);
        foreach (var offers in scratchOffers)
            if (offers.Extra != null) foreach (var act in offers.Extra) Take(found, act);
        return found;
    }

    private void RefreshActs()
    {
        if (!Scheldemist.Dev.SpeedComparison.Cached) { acts = FindOriginal(); return; }
        acts = FindCached(scratchActs, true);
    }

    /// <summary>Same-state verification of the prompt selection, without pressing any key.</summary>
    public bool SameActions()
    {
        var original = FindOriginal(); var current = FindCached(new List<Act>(4));
        if (original.Count != current.Count) return false;
        for (int i = 0; i < original.Count; i++)
        {
            var a = original[i]; var b = current[i];
            if (a.Key != b.Key || a.Text != b.Text || a.X != b.X || a.Y != b.Y || a.Z != b.Z || a.Self != b.Self || a.Cone != b.Cone || a.Run.Method != b.Run.Method) return false;
        }
        return true;
    }

    public void RepeatPrompt() { actsT = 0; _Process(0); }

    /// <summary>Press a key as the player does (the checks too): the list is asked afresh, then the key's deed runs. False: nothing for that key.</summary>
    public bool Press(Key key)
    {
        RefreshActs();
        var act = acts.FirstOrDefault(a => a.Key == key);
        if (act == null) return false;
        act.Run();
        actsT = 0;
        return true;
    }

    public override void _UnhandledInput(InputEvent e)
    {
        if (e is not InputEventKey { Pressed: true, Echo: false } k) return;
        if (Jef.I == null || Jef.I.TestInput) return;
        // the keys as the player bound them (Menu/Keys.cs): use, second, third and fourth choice
        Key key = Key.None;
        foreach (var (godot, action) in Actions)
            if (Scheldemist.Menu.Keys.Is(e, action))
                key = godot;
        if (key == Key.None) return;
        // the list shown may be a tenth of a second old: asked afresh for the key pressed
        if (!acts.Any(a => a.Key == key)) return;
        if (Press(key)) GetViewport().SetInputAsHandled();
    }

    // ------------------------------------------------------------------ the prompt line (.prompt)

    public override void _Ready()
    {
        Build();
        GetViewport().SizeChanged += Build;
    }

    private static float UiScale(float width) => width >= 3000 ? 2.2f : width >= 2200 ? 1.8f : width >= 1600 ? 1.5f : 1.3f;

    private void Build()
    {
        var win = GetViewport().GetVisibleRect().Size;
        float s = UiScale(win.X);
        if (label == null || Math.Abs(s - uiScale) > 0.01f)
        {
            label?.QueueFree();
            uiScale = s;
            label = new Label
            {
                Name = "Prompt",
                LabelSettings = new LabelSettings
                {
                    Font = Fonts.Hand,
                    FontSize = Mathf.RoundToInt(18 * s),
                    FontColor = new Color("d8cfb8"),
                    ShadowColor = new Color(0, 0, 0, 0.85f),
                    ShadowSize = Mathf.RoundToInt(5 * s),
                    ShadowOffset = Vector2.Zero,
                },
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Bottom,
                MouseFilter = Control.MouseFilterEnum.Ignore,
                Text = Text,
            };
            Main.I.Ui.AddChild(label);
        }
        // left 50%, bottom 22%, never wider than 90% of the screen; it grows upward
        float w = win.X * 0.9f;
        label.Size = new Vector2(w, win.Y * 0.4f);
        label.Position = new Vector2((win.X - w) / 2, win.Y * 0.78f - win.Y * 0.4f);
    }

    /// <summary>An act's key is one of the four choices of the hands; the player may have bound another key to it.</summary>
    private static readonly (Key Key, string Action)[] Actions = { (Key.E, "use"), (Key.F, "second"), (Key.G, "third"), (Key.R, "fourth") };

    /// <summary>menu/keys.ts keyLabel: the name of the key bound to an act's choice now.</summary>
    public static string KeyName(Key k)
    {
        foreach (var (godot, action) in Actions)
            if (godot == k)
                return Scheldemist.Menu.Keys.Label(action);
        return OS.GetKeycodeString(k);
    }

    public override void _Process(double delta)
    {
        var jef = Jef.I;
        if (jef == null) return;
        actsT -= delta;
        bool shut = IsShut;
        var sig = new Vector3(jef.X, jef.Yaw, jef.Z);
        if (actsT <= 0 || MathF.Sqrt((jef.X - actsAt.X) * (jef.X - actsAt.X) + (jef.Z - actsAt.Z) * (jef.Z - actsAt.Z)) > 0.2f || MathF.Abs(jef.Yaw - actsAt.Y) > 0.15f || shut != actsShut || float.IsNaN(actsAt.X))
        {
            actsT = 0.1;
            actsAt = sig;
            actsShut = shut;
            RefreshActs();
        }
        string text = Scheldemist.Dev.SpeedComparison.Cached ? PromptText(shut) : shut ? "" : string.Join("\n", acts.Select(a => $"{KeyName(a.Key)}  {a.Text}"));
        if (text != Text)
        {
            Text = text;
            label.Text = text;
        }
        label.Visible = text != "";
    }
    private string PromptText(bool shut)
    {
        if (shut) { promptLines.Clear(); return ""; }
        bool changed = promptLines.Count != acts.Count;
        for (int i = 0; i < acts.Count && !changed; i++)
        {
            var act = acts[i]; var line = promptLines[i];
            changed = line.Key != act.Key || line.Text != act.Text || line.Name != KeyName(act.Key);
        }
        if (!changed) return Text;
        prompt.Clear(); promptLines.Clear();
        foreach (var act in acts)
        {
            string name = KeyName(act.Key);
            if (prompt.Length > 0) prompt.Append('\n');
            prompt.Append(name).Append("  ").Append(act.Text);
            promptLines.Add((act.Key, name, act.Text));
        }
        return prompt.ToString();
    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Ui;

namespace Scheldemist.Menu;

/// <summary>
/// "Your character", the step after New game (the browser's menu/character.ts): the name, sex, age and build; a
/// picker and colour swatches for each part of the look; Random (Flemish and Walloon names, a look of the period);
/// Sunday best; Start. The rules are the server's own (Character.cs, the port of shared/character.ts); the server
/// checks and stores the profile (PUT /api/player/profile) before the new week begins.
///
/// HOOK for the people's part: the turning figure. `CharacterSheet.MakePreview` gets the frame (270 x 380 CSS px,
/// dark) and gives back what to call with the profile each time it changes; put a SubViewportContainer with the
/// dressed model in the frame. Until it is set, a flat tailor's dummy in the chosen colours stands there.
/// </summary>
public static partial class CharacterSheet
{
    /// <summary>The people's part sets this: (the frame to fill) => (show this profile).</summary>
    public static Func<Control, Action<Profile>>? MakePreview { get; set; }

    private static Sheet? sheet;
    private static Profile draft = Character.Jef;
    private static Action<Profile>? onDone;
    private static Action? onCancel;
    private static Action<Profile>? show;
    private static LineEdit first = null!, last = null!;
    private static Label err = null!, msg = null!, lookLine = null!;
    private static VBoxContainer rows = null!;
    private static bool busy;
    private static string errText = "";

    public static bool IsOpen => sheet != null && Dialogs.IsOpen(sheet);
    /// <summary>The character as it stands on the sheet.</summary>
    public static Profile? Draft => IsOpen ? draft : null;
    /// <summary>The look in words, as under the figure.</summary>
    public static string Look => IsOpen ? lookLine.Text : "";

    /// <summary>
    /// Open the sheet. `done` runs once the server has the profile (the menu then starts the new week); Back or Esc
    /// closes the sheet and runs `cancel`.
    /// </summary>
    public static void Open(Action<Profile> done, Action? cancel = null, string kicker = "A new week in Antwerp")
    {
        onDone = done;
        onCancel = cancel;
        draft = Character.ClampProfile(Character.Jef).Profile;
        busy = false;
        errText = "";
        Build(kicker);
        // the profile the server has now (a character made for an earlier week starts the sheet)
        var s = sheet;
        if (ServerLink.I?.Api is { } api)
            api.Run(api.Profile(), v =>
            {
                if (sheet != s) return;
                bool made = v.TryGetProperty("made", out var m) && m.ValueKind == JsonValueKind.True;
                if (made && v.TryGetProperty("profile", out var p)) draft = Character.FromJson(p);
                Names();
                Rows();
            }, _ => { });
    }

    private static void Build(string kicker)
    {
        var s = new Sheet("Your character", kicker, 940);
        sheet = s;
        // the figure stays where it is while the rows scroll (the browser's sticky column): the sheet's own scroll is
        // off, the rows have theirs; the figure's frame is as high as the window leaves room for
        s.Scroll.VerticalScrollMode = ScrollContainer.ScrollMode.Disabled;
        s.Body.SizeFlagsVertical = Control.SizeFlags.ExpandFill;
        s.Body.GetParent<Control>().SizeFlagsVertical = Control.SizeFlags.ExpandFill;
        var win = Main.I.GetViewport().GetVisibleRect().Size;
        float room = Math.Min(win.Y * 0.9f, Kit.Px(900)) - Kit.Px(190) - Kit.Px(13.5f * 1.35f * 4 + 12 + 30);
        float frameH = Math.Clamp(room, Kit.Px(180), Kit.Px(380));
        var grid = new HBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore, SizeFlagsVertical = Control.SizeFlags.ExpandFill };
        grid.AddThemeConstantOverride("separation", Kit.Px(18));

        // the left: the figure, its look in words, Random and Sunday best
        var left = new VBoxContainer { CustomMinimumSize = new Vector2(Kit.Px(290), 0), MouseFilter = Control.MouseFilterEnum.Ignore };
        left.AddThemeConstantOverride("separation", Kit.Px(6));
        var frame = new Panel { CustomMinimumSize = new Vector2(frameH * 270 / 380, frameH), SizeFlagsHorizontal = Control.SizeFlags.ShrinkCenter, ClipContents = true, TooltipText = "Drag to turn" };
        frame.AddThemeStyleboxOverride("panel", Kit.Box(new Color("2b2721"), Kit.Ink, 1.5f, 0, 0, 0));
        if (MakePreview != null) show = MakePreview(frame);
        else
        {
            var dummy = new Dummy();
            dummy.SetAnchorsPreset(Control.LayoutPreset.FullRect);
            frame.AddChild(dummy);
            show = dummy.Show;
        }
        left.AddChild(frame);
        lookLine = Kit.Text("", Fonts.PrintItalic, 13.5f, Kit.InkSoft, true);
        lookLine.HorizontalAlignment = HorizontalAlignment.Center;
        lookLine.CustomMinimumSize = new Vector2(Kit.Px(280), Kit.Px(13.5f * 1.35f * 4));
        left.AddChild(lookLine);
        var btns = new HBoxContainer { Alignment = BoxContainer.AlignmentMode.Center, MouseFilter = Control.MouseFilterEnum.Ignore };
        btns.AddThemeConstantOverride("separation", Kit.Px(8));
        btns.AddChild(new InkButton(InkButton.Look.Btn, "Random", () => Press("random")) { Small = true, TooltipText = "A name and a look of 1873, Flemish or Walloon", Name = "random" });
        btns.AddChild(new InkButton(InkButton.Look.Btn, "Sunday best", () => Press("sunday")) { Small = true, TooltipText = "Black and white linen, a good hat", Name = "sunday" });
        left.AddChild(btns);
        grid.AddChild(left);

        // the right: the names, then a row for each part of the look
        var right = new VBoxContainer { SizeFlagsHorizontal = Control.SizeFlags.ExpandFill, MouseFilter = Control.MouseFilterEnum.Ignore };
        right.AddThemeConstantOverride("separation", 0);
        var rightScroll = new ScrollContainer { HorizontalScrollMode = ScrollContainer.ScrollMode.Disabled, FollowFocus = true, SizeFlagsHorizontal = Control.SizeFlags.ExpandFill, SizeFlagsVertical = Control.SizeFlags.ExpandFill };
        Sheet.ThinBar(rightScroll.GetVScrollBar());
        var rightPad = new MarginContainer { SizeFlagsHorizontal = Control.SizeFlags.ExpandFill, MouseFilter = Control.MouseFilterEnum.Ignore };
        rightPad.AddThemeConstantOverride("margin_right", Kit.Px(12));
        rightPad.AddThemeConstantOverride("margin_left", Kit.Px(3));
        rightPad.AddThemeConstantOverride("margin_top", Kit.Px(3));
        rightPad.AddChild(right);
        rightScroll.AddChild(rightPad);
        var names = new HBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        names.AddThemeConstantOverride("separation", Kit.Px(14));
        first = NameBox(names, "First name", Character.NameMaxFirst);
        last = NameBox(names, "Family name", Character.NameMaxLast);
        right.AddChild(names);
        err = Kit.Text("", Fonts.Hand, 14, Kit.Bad, true);
        err.CustomMinimumSize = new Vector2(0, Kit.Px(22));
        right.AddChild(err);
        rows = new VBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        rows.AddThemeConstantOverride("separation", 0);
        right.AddChild(rows);
        grid.AddChild(rightScroll);
        var pad = new MarginContainer { MouseFilter = Control.MouseFilterEnum.Ignore, SizeFlagsVertical = Control.SizeFlags.ExpandFill };
        pad.AddThemeConstantOverride("margin_top", Kit.Px(4));
        pad.AddChild(grid);
        s.Body.AddChild(pad);

        msg = Kit.Text("", Fonts.Hand, 15, Kit.Rust);
        s.Foot.AddChild(msg);
        s.Foot.AddChild(Kit.Spring());
        s.Foot.AddChild(new InkButton(InkButton.Look.Btn, "Back", () => Dialogs.Close(s)) { Name = "back" });
        s.Foot.AddChild(new InkButton(InkButton.Look.Primary, "Start", Start) { Name = "start" });

        Names();
        Rows();
        Dialogs.Open(s, () =>
        {
            if (sheet != s) return;
            sheet = null;
            show = null;
            // Back or Esc: no new week; a Start that went through has cleared this
            var c = onCancel;
            onCancel = null;
            c?.Invoke();
        });
        first.GrabFocus();
        first.SelectAll();
        s.GetTree().CreateTimer(0.05, true, false, true).Timeout += () =>
        {
            if (sheet == s) rightScroll.ScrollVertical = 0;
        };
    }

    private static LineEdit NameBox(HBoxContainer into, string label, int max)
    {
        var col = new VBoxContainer { SizeFlagsHorizontal = Control.SizeFlags.ExpandFill, MouseFilter = Control.MouseFilterEnum.Ignore };
        col.AddThemeConstantOverride("separation", Kit.Px(2));
        col.AddChild(Kit.Text(label.ToUpperInvariant(), Fonts.Print, 13, Kit.InkSoft, false, 0.18f));
        var e = Kit.Input("", 100, false, false, "", 22, Fonts.Hand);
        e.MaxLength = max;
        e.TextChanged += _ => TypedName();
        e.TextSubmitted += _ => Start();
        col.AddChild(e);
        into.AddChild(col);
        return e;
    }

    private static void Names()
    {
        first.Text = draft.First;
        last.Text = draft.Last;
        errText = "";
        err.Text = "";
    }

    private static string Cap(string s) => s.Length == 0 ? s : char.ToUpperInvariant(s[0]) + s[1..];

    private static void TypedName()
    {
        string? f = Character.CleanName(first.Text, Character.NameMaxFirst);
        string? l = Character.CleanName(last.Text, Character.NameMaxLast, true);
        errText = first.Text.Trim() == "" ? "A first name, please."
            : f == null ? "That will not do for a name in 1873: letters only, and not a word of the street."
            : l == null ? "The family name: letters only." : "";
        err.Text = errText;
        if (!string.IsNullOrEmpty(f)) draft.First = f;
        if (l != null) draft.Last = l;
    }

    // ------------------------------------------------------------------ the rows

    private static Control Row(string label, params Control[] ctl)
    {
        var row = new HBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        row.AddThemeConstantOverride("separation", Kit.Px(12));
        var l = Kit.Text(label, Fonts.Print, 16, Kit.Ink);
        l.CustomMinimumSize = new Vector2(Kit.Px(118), 0);
        l.SizeFlagsVertical = Control.SizeFlags.ShrinkCenter;
        row.AddChild(l);
        var flow = new HFlowContainer { SizeFlagsHorizontal = Control.SizeFlags.ExpandFill, MouseFilter = Control.MouseFilterEnum.Ignore };
        flow.AddThemeConstantOverride("h_separation", Kit.Px(10));
        flow.AddThemeConstantOverride("v_separation", Kit.Px(6));
        foreach (var c in ctl)
        {
            c.SizeFlagsVertical = Control.SizeFlags.ShrinkCenter;
            flow.AddChild(c);
        }
        row.AddChild(flow);
        var box = new RowBox { Colour = Kit.InkFaint, MouseFilter = Control.MouseFilterEnum.Ignore };
        box.AddThemeConstantOverride("margin_top", Kit.Px(5));
        box.AddThemeConstantOverride("margin_bottom", Kit.Px(5));
        box.AddChild(row);
        return box;
    }

    private static Seg SegOf(string name, IEnumerable<Choice> list, string value, Action<Profile, string> set) =>
        new(list.Select(c => (c.Id, c.Label)).ToArray(), value, v => Change(p => set(p, v))) { Name = name };

    private static Select Sel(string name, IEnumerable<Choice> list, string value, Action<Profile, string> set) =>
        new(list.Select(c => (c.Id, c.Label)).ToArray(), value, v => Change(p => set(p, v)), 200) { Name = name };

    private static Control[] Swatches(string name, IReadOnlyList<Swatch> list, string value, Action<Profile, string> set)
    {
        var h = new HBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore, Name = "sw_" + name };
        h.AddThemeConstantOverride("separation", Kit.Px(4));
        foreach (var s in list)
        {
            string id = s.Id;
            h.AddChild(new InkButton(InkButton.Look.Swatch, "", () => Change(p => set(p, id))) { Colour = new Color((uint)((s.Hex << 8) | 0xff)), On = s.Id == value, TooltipText = s.Label, Name = id });
        }
        var nm = Kit.Text(list.FirstOrDefault(s => s.Id == value)?.Label ?? "", Fonts.PrintItalic, 13, Kit.InkSoft);
        nm.CustomMinimumSize = new Vector2(Kit.Px(90), 0);
        return new Control[] { h, nm };
    }

    private static Control[] With(Control first, params Control[] rest) => new[] { first }.Concat(rest).ToArray();

    private static Label? ageVal;

    /// <summary>character.ts draw(): the rows as the character stands (a woman has no Face row, a smock no apron ...).</summary>
    private static void Rows()
    {
        foreach (var c in rows.GetChildren())
        {
            rows.RemoveChild(c);
            c.QueueFree();
        }
        var p = draft;
        bool w = p.Sex == "woman";
        var cl = p.Clothes;
        string band = Character.AgeBand(p.Age);
        rows.AddChild(Row("Sex", SegOf("sex", new[] { new Choice("man", "Man"), new Choice("woman", "Woman") }, p.Sex, (q, v) => q.Sex = v)));
        var bands = new Seg(Character.AgeBands.Select(b => (b.Id, b.Id)).ToArray(), band, v =>
        {
            var b = Character.AgeBands.First(x => x.Id == v);
            Change(q => q.Age = Math.Clamp(q.Age < b.Min || q.Age > b.Max ? (int)Math.Round((b.Min + b.Max) / 2.0, MidpointRounding.AwayFromZero) : q.Age, b.Min, b.Max));
        }) { Name = "band" };
        ageVal = Kit.Text(p.Age.ToString(), Fonts.Hand, 20, Kit.Ink);
        var age = new InkSlider(Character.AgeMin, Character.AgeMax, 1, p.Age, v => v.ToString("0"), v =>
        {
            // the slider drags through many ages: the row stays, the number and the figure follow
            var q = draft.Clone();
            q.Age = (int)v;
            draft = Character.ClampProfile(q).Profile;
            if (ageVal != null) ageVal.Text = draft.Age.ToString();
            ShowLook();
        }, _ => Rows()) { NoOutput = true, TrackWidth = 200, Name = "age" };
        rows.AddChild(Row("Age", bands, age, ageVal));
        rows.AddChild(Row("Build", SegOf("build", Character.Builds, p.Build, (q, v) => q.Build = v)));
        rows.AddChild(Row("Skin", Swatches("skin", Character.Skin, p.Skin, (q, v) => q.Skin = v)));
        rows.AddChild(Row("Hair", With(Sel("hairStyle", Character.OptionsFor(Character.HairStyles, p.Sex), p.Hair.Style, (q, v) => q.Hair.Style = v), Swatches("hair", Character.HairColours, p.Hair.Colour, (q, v) => q.Hair.Colour = v))));
        if (!w) rows.AddChild(Row("Face", Sel("face", Character.OptionsFor(Character.Faces, p.Sex), p.Face, (q, v) => q.Face = v)));
        var head = new List<Control> { Sel("head", Character.OptionsFor(Character.Heads, p.Sex), cl.Head.Kind, (q, v) => q.Clothes.Head.Kind = v) };
        if (cl.Head.Kind != "none") head.AddRange(Swatches("head", Character.Cloth, cl.Head.Colour, (q, v) => q.Clothes.Head.Colour = v));
        rows.AddChild(Row(w ? "Head" : "Hat or cap", head.ToArray()));
        var coat = new List<Control> { Sel("coat", Character.OptionsFor(Character.Coats, p.Sex), cl.Coat.Kind, (q, v) => q.Clothes.Coat.Kind = v) };
        if (cl.Coat.Kind != "none" && cl.Coat.Kind != "no_shawl") coat.AddRange(Swatches("coat", Character.Cloth, cl.Coat.Colour, (q, v) => q.Clothes.Coat.Colour = v));
        rows.AddChild(Row(w ? "Shawl" : "Coat", coat.ToArray()));
        rows.AddChild(Row(w ? "Blouse" : "Shirt", Swatches("shirt", Character.Cloth, cl.Shirt.Colour, (q, v) => q.Clothes.Shirt.Colour = v)));
        if (!w && cl.Coat.Kind != "smock" && cl.Coat.Kind != "coat") rows.AddChild(Row("Waistcoat", Swatches("vest", Character.Cloth, cl.Vest.Colour, (q, v) => q.Clothes.Vest.Colour = v)));
        rows.AddChild(Row(w ? "Skirt" : "Trousers", Swatches("lower", Character.Cloth, cl.Lower.Colour, (q, v) => q.Clothes.Lower.Colour = v)));
        if (Character.ApronAllowed(p))
        {
            var apron = new List<Control> { SegOf("apron", Character.Aprons, cl.Apron.Kind, (q, v) => q.Clothes.Apron.Kind = v) };
            if (cl.Apron.Kind == "apron") apron.AddRange(Swatches("apron", Character.Cloth, cl.Apron.Colour, (q, v) => q.Clothes.Apron.Colour = v));
            rows.AddChild(Row("Apron", apron.ToArray()));
        }
        else rows.AddChild(Row("Apron", Kit.Text($"Not under a {(cl.Coat.Kind == "smock" ? "smock" : "long coat")}.", Fonts.PrintItalic, 14, Kit.InkSoft)));
        rows.AddChild(Row("Feet", With(SegOf("feet", Character.Feet, cl.Feet.Kind, (q, v) => q.Clothes.Feet.Kind = v), Swatches("feet", Character.SwatchesFor("feet", cl.Feet.Kind), cl.Feet.Colour, (q, v) => q.Clothes.Feet.Colour = v))));
        ShowLook();
    }

    private static void ShowLook()
    {
        lookLine.Text = Cap(Character.LookLine(draft)) + ".";
        show?.Invoke(draft);
    }

    /// <summary>Change the draft and put it through the same clamp as the server (a man's bonnet goes, and so on).</summary>
    private static void Change(Action<Profile> f)
    {
        var p = draft.Clone();
        f(p);
        string wasSex = draft.Sex;
        if (p.Sex != wasSex)
        {
            // a new sex: that sex's clothes and face; the name, age and colours kept where they fit
            var d = p.Sex == "woman" ? Character.Mie : Character.Jef;
            p.Face = d.Face;
            p.Hair.Style = d.Hair.Style;
            p.Clothes = d.Clothes.Clone();
            string? typed = Character.CleanName(first.Text, Character.NameMaxFirst);
            if (string.IsNullOrEmpty(typed) || typed == (wasSex == "woman" ? Character.Mie.First : Character.Jef.First)) p.First = d.First;
        }
        if (p.Best && JsonSerializer.Serialize(p.Clothes) != JsonSerializer.Serialize(draft.Clothes)) p.Best = false;
        draft = Character.ClampProfile(p).Profile;
        if (p.Sex != wasSex) Names();
        Callable.From(Rows).CallDeferred();
    }

    /// <summary>The sheet's own buttons, by name ("random", "sunday"): the mouse and a test press them alike.</summary>
    public static void Press(string what)
    {
        if (!IsOpen) return;
        if (what == "random")
        {
            draft = Character.RandomProfile();
            Names();
            Rows();
        }
        else if (what == "sunday")
        {
            draft = Character.SundayBest(draft);
            Rows();
        }
    }

    private static void Start()
    {
        if (busy || sheet == null) return;
        TypedName();
        if (errText != "")
        {
            first.GrabFocus();
            return;
        }
        var api = ServerLink.I?.Api;
        if (api == null)
        {
            msg.Text = "The server did not take it (the game server does not answer).";
            return;
        }
        busy = true;
        msg.Text = "Writing your name in the book...";
        var s = sheet;
        api.Run(api.PutProfile(Character.ToElement(draft)), r =>
        {
            if (sheet != s) return;
            busy = false;
            if (!r.TryGetProperty("profile", out var pj))
            {
                msg.Text = "The server did not take it.";
                return;
            }
            var got = Character.FromJson(pj);
            var fix = r.TryGetProperty("fixed", out var fx) && fx.ValueKind == JsonValueKind.Array ? fx.EnumerateArray().Select(x => x.GetString()).ToList() : new List<string?>();
            if (fix.Contains("first") || fix.Contains("last"))
            {
                // the server would not take the name as typed: say so and let the player look again
                draft = got;
                Names();
                Rows();
                errText = $"The clerk wrote \"{got.First}{(got.Last != "" ? " " + got.Last : "")}\" instead. Change it, or press Start again.";
                err.Text = errText;
                errText = "";
                msg.Text = "";
                return;
            }
            msg.Text = "";
            var done = onDone;
            onCancel = null;
            Dialogs.Close(s);
            done?.Invoke(got);
        }, e =>
        {
            if (sheet != s) return;
            msg.Text = $"The server did not take it ({e.Message}).";
            busy = false;
        });
    }

    /// <summary>
    /// The stand-in for the turning figure until the people's part brings the model: a flat tailor's dummy, each part
    /// in the colour chosen, so a colour picked shows at once.
    /// </summary>
    private partial class Dummy : Control
    {
        private Profile? p;
        public void Show(Profile profile)
        {
            p = profile;
            QueueRedraw();
        }

        private static Color Of(IReadOnlyList<Swatch> list, string id) => list.FirstOrDefault(s => s.Id == id) is { } s ? new Color((uint)((s.Hex << 8) | 0xff)) : new Color("777777");

        public override void _Draw()
        {
            if (p == null) return;
            float w = Size.X, h = Size.Y, u = h / 380f;
            float cx = w / 2;
            bool woman = p.Sex == "woman";
            float girth = p.Build == "stout" ? 1.2f : p.Build == "slight" ? 0.86f : 1f;
            var c = p.Clothes;
            var skin = Of(Character.Skin, p.Skin);
            // the cobbles under the feet
            DrawSetTransform(new Vector2(cx, 352 * u), 0, new Vector2(1, 0.28f));
            DrawCircle(Vector2.Zero, 88 * u, new Color("4a443a"));
            DrawSetTransform(Vector2.Zero);
            void Box(float x0, float y0, float x1, float y1, Color col) => DrawRect(new Rect2((cx + x0 * girth * u), y0 * u, (x1 - x0) * girth * u, (y1 - y0) * u), col);
            var feet = Of(Character.SwatchesFor("feet", c.Feet.Kind), c.Feet.Colour);
            var lower = Of(Character.Cloth, c.Lower.Colour);
            // the legs or the skirt, the feet
            if (woman) DrawColoredPolygon(new[] { new Vector2(cx - 30 * girth * u, 200 * u), new Vector2(cx + 30 * girth * u, 200 * u), new Vector2(cx + 52 * girth * u, 338 * u), new Vector2(cx - 52 * girth * u, 338 * u) }, lower);
            else
            {
                Box(-30, 200, -4, 338, lower);
                Box(4, 200, 30, 338, lower);
            }
            if (c.Feet.Kind != "bare")
            {
                Box(-34, 336, -2, 350, feet);
                Box(2, 336, 34, 350, feet);
            }
            else
            {
                Box(-30, 338, -6, 348, skin);
                Box(6, 338, 30, 348, skin);
            }
            // the shirt, the waistcoat, the coat or shawl over them
            var shirt = Of(Character.Cloth, c.Shirt.Colour);
            Box(-34, 108, 34, 204, shirt);
            Box(-52, 112, -34, 196, shirt);
            Box(34, 112, 52, 196, shirt);
            if (!woman && c.Coat.Kind != "smock" && c.Coat.Kind != "coat")
            {
                var vest = Of(Character.Cloth, c.Vest.Colour);
                Box(-34, 116, -8, 200, vest);
                Box(8, 116, 34, 200, vest);
            }
            if (c.Coat.Kind != "none" && c.Coat.Kind != "no_shawl")
            {
                var coat = Of(Character.Cloth, c.Coat.Colour);
                if (woman) DrawColoredPolygon(new[] { new Vector2(cx - 54 * girth * u, 110 * u), new Vector2(cx + 54 * girth * u, 110 * u), new Vector2(cx + 40 * girth * u, 170 * u), new Vector2(cx, 196 * u), new Vector2(cx - 40 * girth * u, 170 * u) }, coat);
                else
                {
                    float hem = c.Coat.Kind is "coat" or "smock" ? 262 : 206;
                    Box(-36, 108, c.Coat.Kind == "smock" ? 36 : -10, hem, coat);
                    if (c.Coat.Kind != "smock") Box(10, 108, 36, hem, coat);
                    Box(-54, 110, -36, 198, coat);
                    Box(36, 110, 54, 198, coat);
                }
            }
            if (c.Apron.Kind == "apron" && Character.ApronAllowed(p)) Box(-24, 150, 24, 300, Of(Character.Cloth, c.Apron.Colour));
            // the hands, the neck and the head
            Box(-52, 196, -36, 212, skin);
            Box(36, 196, 52, 212, skin);
            DrawRect(new Rect2(cx - 9 * u, 92 * u, 18 * u, 20 * u), skin);
            DrawCircle(new Vector2(cx, 72 * u), 27 * u, skin, true, -1, true);
            var hair = Of(Character.HairColours, p.Hair.Colour);
            if (p.Hair.Style != "bald") DrawArc(new Vector2(cx, 70 * u), 25 * u, MathF.PI * 1.02f, MathF.PI * 1.98f, 16, hair, 9 * u, true);
            if (woman && p.Hair.Style != "bald") DrawCircle(new Vector2(cx, 44 * u), 10 * u, hair, true, -1, true);
            if (!woman && p.Face is not ("shaven" or "clean" or "none"))
                DrawArc(new Vector2(cx, 78 * u), 20 * u, MathF.PI * 0.15f, MathF.PI * 0.85f, 12, hair, 6 * u, true);
            if (c.Head.Kind != "none")
            {
                var hat = Of(Character.Cloth, c.Head.Colour);
                DrawRect(new Rect2(cx - 30 * u, 44 * u, 60 * u, 10 * u), hat);
                DrawRect(new Rect2(cx - 22 * u, (woman ? 34 : 24) * u, 44 * u, (woman ? 12 : 22) * u), hat);
            }
        }
    }
}

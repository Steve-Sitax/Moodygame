using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Game;

/// <summary>
/// A mark on the map. Kind: "goal" (your job: go here), "work" (work offered), "event", "place", "shop" or "bed".
/// Detail: a second line for the hover and the list (the job's title, the event's place). Icon: its picture
/// (MapIcons.Icons); none: the kind's own.
/// </summary>
public sealed record MapMark(float X, float Z, string Label, string Kind, string? Detail = null, string? Icon = null);

/// <summary>A thing that moves, for the map: Kind "omnibus", "ship", "boat", "train", "cart" ...; Yaw as the world turns it (atan2(dx, dz) of its heading).</summary>
public sealed record MapMover(string Kind, float X, float Z, float Yaw, string Label);

/// <summary>A piece of the map window that draws itself with the map's own code.</summary>
public partial class MapSheet : Control
{
    public Action<MapSheet>? Paint;
    public override void _Draw() => Paint?.Invoke(this);
}

/// <summary>
/// The paper map (M): client/src/game/map.ts. Drawn from the traced 1873 city (shared/city.json) in the colours of
/// the Vuillaume map: red blocks, blue-grey water, ink names. North is up. Every place is an icon in a badge
/// (MapIcons), its name shows when the cursor is on it, with how far and which way; the key over the corner turns
/// each kind on and off (kept in user://map.json). Only your job's step and the street and square names are written
/// on the paper, and only where there is room. The map moves (WASD, the arrows, a drag) and zooms (+ -, the wheel);
/// C goes back to you; a number key finds a job of the list beside it.
///
/// For the other parts:
///   TownMap.I.Open, .Toggle(), .Show(), .Close(), .OpenChanged     the window (M, E and Esc are its own keys while OwnKeys)
///   TownMap.I.CanOpen = () => no other window is up                may M open it now?
///   TownMap.I.AddMarks(() => marks)                                more marks (events, boxes, people with work)
///   TownMap.I.JobMarks = () => marks                               the job's step, from the part that runs the job
///   TownMap.I.WayGoal = () => where the followed job goes now      the dotted way on foot leads there
///   TownMap.I.PersonAt = id => where that person stands            for the marks of people with work
///   TownMap.I.SetMovers(list)                                      the omnibuses, ships and trains, when they run
///
/// Closed it costs nothing: no node of it is drawn or asked each frame.
/// </summary>
[GamePart(120)]
public partial class TownMap : Node
{
    public static TownMap? I { get; private set; }

    // ------------------------------------------------------------------ for the other parts

    public bool Open { get; private set; }
    /// <summary>The window opened (true) or closed. The player's part stands still while it is open.</summary>
    public event Action<bool>? OpenChanged;
    /// <summary>May the M key open the map now (no talk, board or menu up)? Not set: always.</summary>
    public Func<bool>? CanOpen { get; set; }
    /// <summary>The map takes M (open and close), E and Esc (close) itself. A window stack that sends the keys turns this off and calls Toggle and Close.</summary>
    public bool OwnKeys { get; set; } = true;
    /// <summary>The job's marks, from the part that runs the job (the step now, "then: ...", the other jobs in hand). Not set: a guess from the store's jobs.</summary>
    public Func<IEnumerable<MapMark>>? JobMarks { get; set; }
    /// <summary>Where the followed job goes now (x, z): the map draws the way on foot to it. Not set: the first job mark.</summary>
    public Func<Vector2?>? WayGoal { get; set; }
    /// <summary>Where a person stands now (x, z), by id: for "work offered". Not set (or null): his post by day.</summary>
    public Func<string, Vector2?>? PersonAt { get; set; }

    private readonly List<Func<IEnumerable<MapMark>>> sources = new();
    /// <summary>More marks, asked each time the map is drawn (twice a second while it is open).</summary>
    public void AddMarks(Func<IEnumerable<MapMark>> source) => sources.Add(source);

    private List<MapMover> movers = new();
    /// <summary>The moving things to show (the whole list each time; null or empty: none).</summary>
    public void SetMovers(IEnumerable<MapMover>? list)
    {
        movers = list?.ToList() ?? new List<MapMover>();
        if (Open) redrawT = Math.Min(redrawT, 0.1);
    }

    // ------------------------------------------------------------------ the look (style.css .citymap, map.ts)

    private static readonly IReadOnlyDictionary<string, string> KindIcon = new Dictionary<string, string> { ["goal"] = "goal", ["work"] = "work", ["event"] = "event", ["place"] = "board", ["shop"] = "vase", ["bed"] = "bed" };
    private static readonly IReadOnlyDictionary<string, Color> KindInk = new Dictionary<string, Color>
    {
        ["goal"] = MapIcons.Ink("8a1a10"), ["work"] = MapIcons.Ink("1a3a6a"), ["event"] = MapIcons.Ink("4a2a5a"),
        ["place"] = MapIcons.Ink("2a2420"), ["shop"] = MapIcons.Ink("2a2420"), ["bed"] = MapIcons.Ink("2a2420"),
    };
    private static readonly Color Paper = MapIcons.Ink("d8cfb8");
    private static readonly Color Ink = MapIcons.Ink("2a2420");
    private static readonly Color OffMap = MapIcons.Ink("d6cbb0");
    private static readonly Color River = MapIcons.Ink("9fb4b2");
    private static readonly Color PaleEdge = MapIcons.Sepia(new Color(230 / 255f, 220 / 255f, 196 / 255f, 0.85f));
    private static readonly Color PaleWay = MapIcons.Sepia(new Color(230 / 255f, 220 / 255f, 196 / 255f, 0.8f));
    private static readonly Color KeyPaper = MapIcons.Sepia(new Color(230 / 255f, 220 / 255f, 196 / 255f, 0.94f));
    private static readonly Color Border = MapIcons.Ink("5a4a3a");
    private static readonly Color Hot = new(122 / 255f, 88 / 255f, 40 / 255f, 0.16f);
    private const float KeyW = 216; // 206 wide, 4 of padding and the border each side
    private const float RowH = 22;
    private const float HeadH = 18.1f;
    private const float SideW = 250;

    private static string IconOf(MapMark m) => m.Icon != null && MapIcons.Icons.ContainsKey(m.Icon) ? m.Icon : KindIcon.GetValueOrDefault(m.Kind, "vase");
    private static string CatOf(MapMark m) => MapIcons.Icons[IconOf(m)].Cat;
    private static bool Quest(MapMark m) => m.Kind is "goal" or "work" or "event";

    private static Font? italicPrint, italicHand;
    /// <summary>The print's own italic (the names of the quays, the water and the gates): godot/fonts, the browser's face.</summary>
    private static Font PrintItalic => italicPrint ??= LoadItalic();
    /// <summary>The hand has no italic: the browser slants it, and so does this.</summary>
    private static Font HandItalic => italicHand ??= new FontVariation { BaseFont = Fonts.Hand, VariationTransform = new Transform2D(1, 0.2f, 0, 1, 0, 0) };

    private static Font LoadItalic()
    {
        const string path = "res://fonts/old-standard-tt-latin-400-italic.woff2";
        if (ResourceLoader.Exists(path) && GD.Load<Font>(path) is { } f) return f;
        var raw = new FontFile();
        if (raw.LoadDynamicFont(ProjectSettings.GlobalizePath(path)) == Error.Ok) return raw;
        GD.PrintErr($"font not found: {path}");
        return Fonts.Print;
    }

    // ------------------------------------------------------------------ what it holds

    private Task<MapBase>? making;
    private MapBase city = null!;
    private ImageTexture baseTex = null!;
    private Control root = null!;
    private MapSheet paper = null!, canvas = null!, keyBox = null!, tip = null!, side = null!, quill = null!;
    private float mapW, mapH;
    private bool sideOn;
    private string keysText = "";

    private readonly HashSet<string> hidden = new();
    private bool folded;
    private float zoom = 1;
    /// <summary>Where the map looks, in stored px from Jef (moved with WASD, the arrows, a drag).</summary>
    private Vector2 pan;
    private readonly HashSet<Key> held = new();
    private bool dragging;
    private double redrawT;
    /// <summary>The work as listed beside the map (a number key finds one).</summary>
    private List<MapMark> listed = new();
    private readonly List<(Vector2 At, float R, MapMark M)> hits = new();
    private MapMark? hot;
    private (Vector2 At, float R, MapMark M)? hotHit;
    private int hotRow = -2;
    /// <summary>The cursor in the window: the real mouse, or the ink cursor while the game holds the mouse.</summary>
    private Vector2 mouse = new(-1, -1);
    private bool inkOn;
    private Node? frozen;

    // the town's places from the server
    private JsonElement? town;
    private List<MapMark> townMarks = new(), landings = new();

    // the way on foot
    private (List<Vector2>? Pts, Vector2 Goal, Vector2 Asked)? way;
    private bool wayBusy;
    private double wayAt = -10;

    // how long the drawing takes (the self-test tells it)
    private double paintMs, paintMaxMs;
    private int paints;
    /// <summary>The last drawing's parts: gathering the marks, placing them and the names, drawing the marks.</summary>
    private readonly double[] partMs = new double[3];

    /// <summary>Where the kinds turned off are kept ("user://map.json"; the self-test keeps its own).</summary>
    public string SettingsFile { get; set; } = "user://map.json";

    public TownMap()
    {
        I = this;
    }

    public override void _Ready()
    {
        SetProcess(false);
        // the picture of the city and the walk map: made ahead on other threads, taken up when M is first pressed
        string dir = Ways.Root;
        making = Task.Run(() => MapBase.Make(dir));
        Ways.Warm();
        LoadHidden();
        if (ServerLink.I is { } link)
            link.WhenUp(() =>
            {
                var api = link.Api!;
                api.Run(api.Town(), t =>
                {
                    town = t;
                    townMarks = TownMarks(t);
                }, e => GD.PrintErr($"the map has no town places: {e.Message}"));
                api.Run(api.Get<JsonElement>("api/row/world"), w => landings = Landings(w), _ => { });
            });
    }

    public override void _ExitTree()
    {
        if (I == this) I = null;
    }

    // ------------------------------------------------------------------ the kinds turned off, kept between runs

    private void LoadHidden()
    {
        hidden.Clear();
        try
        {
            string file = ProjectSettings.GlobalizePath(SettingsFile);
            if (File.Exists(file))
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(file));
                foreach (var c in doc.RootElement.GetProperty("hidden").EnumerateArray())
                    if (c.GetString() is { } id && MapIcons.Cat.ContainsKey(id)) hidden.Add(id);
                return;
            }
        }
        catch (Exception e)
        {
            GD.PrintErr($"the map's settings could not be read ({e.Message}): the kinds as at first");
            hidden.Clear();
        }
        foreach (var c in MapIcons.Cats)
            if (!c.On) hidden.Add(c.Id);
    }

    private void SaveHidden()
    {
        try
        {
            string file = ProjectSettings.GlobalizePath(SettingsFile);
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            File.WriteAllText(file, JsonSerializer.Serialize(new { hidden = MapIcons.Cats.Where(c => hidden.Contains(c.Id)).Select(c => c.Id) }));
        }
        catch (Exception e)
        {
            GD.PrintErr($"the map's settings could not be kept: {e.Message}");
        }
    }

    /// <summary>Read the kept kinds again (after SettingsFile changed).</summary>
    public void ReloadSettings()
    {
        LoadHidden();
        if (Open) Render();
    }

    /// <summary>Is this kind shown ("food", "pump", "names" ...)?</summary>
    public bool Shows(string cat) => !hidden.Contains(cat);

    /// <summary>Turn a kind on or off, as a click on the key does.</summary>
    public void SetShown(string cat, bool on)
    {
        if (!MapIcons.Cat.ContainsKey(cat) || on == !hidden.Contains(cat)) return;
        if (on) hidden.Remove(cat);
        else hidden.Add(cat);
        SaveHidden();
        if (Open) Render();
    }

    // ------------------------------------------------------------------ open and close

    public void Toggle()
    {
        if (Open) Close();
        else Show();
    }

    public void Show()
    {
        if (Open) return;
        if (root == null) Build();
        Open = true;
        root!.Visible = true;
        held.Clear();
        dragging = false;
        pan = Vector2.Zero;
        // the game holds the mouse: an ink cursor of the map's own, in the middle of the window (game/cursor.ts)
        inkOn = Input.MouseMode == Input.MouseModeEnum.Captured;
        var win = GetViewport().GetVisibleRect().Size;
        mouse = inkOn ? win / 2 : GetViewport().GetMousePosition();
        // the free camera stands still under the map (the player's own part listens to OpenChanged)
        if (Main.I.Cam is FlyCam fly && fly.ProcessMode != ProcessModeEnum.Disabled)
        {
            frozen = fly;
            fly.ProcessMode = ProcessModeEnum.Disabled;
        }
        SetProcess(true);
        Layout();
        Render();
        OpenChanged?.Invoke(true);
    }

    public void Close()
    {
        if (!Open) return;
        Open = false;
        root.Visible = false;
        SetProcess(false);
        held.Clear();
        dragging = false;
        hot = null;
        hotHit = null;
        tip.Visible = false;
        if (frozen != null && IsInstanceValid(frozen)) frozen.ProcessMode = ProcessModeEnum.Inherit;
        frozen = null;
        OpenChanged?.Invoke(false);
    }

    private void Build()
    {
        city = making!.GetAwaiter().GetResult();
        making = null;
        var img = Image.CreateFromData(city.Width, city.Height, false, Image.Format.Rgba8, city.Pixels);
        img.GenerateMipmaps();
        baseTex = ImageTexture.CreateFromImage(img);
        city.Pixels = Array.Empty<byte>();

        root = new Control { Name = "TownMap", MouseFilter = Control.MouseFilterEnum.Ignore, Visible = false };
        root.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        Main.I.Ui.AddChild(root);
        paper = Sheet(PaintPaper);
        paper.RotationDegrees = -0.5f;
        root.AddChild(paper);
        canvas = Sheet(PaintMap);
        canvas.ClipContents = true;
        canvas.TextureFilter = CanvasItem.TextureFilterEnum.LinearWithMipmaps;
        paper.AddChild(canvas);
        keyBox = Sheet(PaintKey);
        keyBox.TextureFilter = CanvasItem.TextureFilterEnum.LinearWithMipmaps;
        canvas.AddChild(keyBox);
        tip = Sheet(PaintTip);
        tip.Visible = false;
        canvas.AddChild(tip);
        side = Sheet(PaintSide);
        side.ClipContents = true;
        paper.AddChild(side);
        quill = Sheet(PaintQuill);
        quill.Size = new Vector2(36, 36);
        root.AddChild(quill);
        MapIcons.MakeAtlas(this, () =>
        {
            if (Open) Render();
        });
        GetViewport().SizeChanged += () =>
        {
            if (!Open) return;
            Layout();
            Render();
        };
    }

    private static MapSheet Sheet(Action<MapSheet> paint) => new() { Paint = paint, MouseFilter = Control.MouseFilterEnum.Ignore };

    /// <summary>The window's sizes, from the game window's (map.ts render, style.css).</summary>
    private void Layout()
    {
        var win = GetViewport().GetVisibleRect().Size;
        sideOn = win.X > 900;
        float sw = sideOn ? SideW : 0;
        mapW = MathF.Round(Math.Max(320, Math.Min(win.X * 0.86f - sw - 30, 1000)));
        mapH = MathF.Round(Math.Min(win.Y * 0.76f, 760));
        keysText = "M, E or Esc close · WASD, the arrows or a drag move · + and - or the wheel zoom · C back to you · 1 to 9 find · point at a mark for its name · click the key to show or hide";
        float inner = mapW + (sideOn ? 12 + SideW : 0);
        float keysH = Fonts.Hand.GetMultilineStringSize(keysText, HorizontalAlignment.Right, inner, 14).Y;
        paper.Size = new Vector2(12 + inner + 12, 12 + mapH + 6 + keysH + 6);
        paper.PivotOffset = paper.Size / 2;
        paper.Position = ((win - paper.Size) / 2).Round();
        canvas.Position = new Vector2(12, 12);
        canvas.Size = new Vector2(mapW, mapH);
        side.Visible = sideOn;
        side.Position = new Vector2(12 + mapW + 12, 12);
        side.Size = new Vector2(SideW, mapH);
        PlaceKey();
        paper.QueueRedraw();
    }

    private float KeyHeight => 2 + 2 + HeadH + (folded ? 0 : 3 + RowH * (2 + MapIcons.Cats.Length)) + 4;

    private void PlaceKey()
    {
        keyBox.Size = new Vector2(KeyW, KeyHeight);
        keyBox.Position = new Vector2(mapW - 10 - KeyW, mapH - 10 - KeyHeight);
        keyBox.QueueRedraw();
    }

    // ------------------------------------------------------------------ keys and the mouse

    public override void _Input(InputEvent e)
    {
        if (e is InputEventKey k)
        {
            if (!Open)
            {
                if (OwnKeys && k.Pressed && !k.Echo && k.PhysicalKeycode == Key.M && !Typing() && (CanOpen?.Invoke() ?? true))
                {
                    Show();
                    GetViewport().SetInputAsHandled();
                }
                return;
            }
            GetViewport().SetInputAsHandled();
            OnKey(k);
            return;
        }
        if (!Open) return;
        if (e is InputEventMouseMotion mm)
        {
            var win = GetViewport().GetVisibleRect().Size;
            inkOn = Input.MouseMode == Input.MouseModeEnum.Captured;
            mouse = inkOn ? new Vector2(Math.Clamp(mouse.X + mm.Relative.X, 0, win.X - 2), Math.Clamp(mouse.Y + mm.Relative.Y, 0, win.Y - 2)) : mm.Position;
            if (dragging)
            {
                float kk = zoom * 0.5f;
                pan -= mm.Relative / kk;
                Render();
            }
            else Hover();
            PlaceQuill();
            GetViewport().SetInputAsHandled();
        }
        else if (e is InputEventMouseButton mb)
        {
            GetViewport().SetInputAsHandled();
            if (!inkOn) mouse = mb.Position;
            if (mb.ButtonIndex == MouseButton.WheelUp && mb.Pressed) ZoomBy(1.25f);
            else if (mb.ButtonIndex == MouseButton.WheelDown && mb.Pressed) ZoomBy(1 / 1.25f);
            else if (mb.ButtonIndex == MouseButton.Left)
            {
                if (!mb.Pressed) dragging = false;
                else if (!ClickKey()) dragging = true;
            }
        }
    }

    /// <summary>A line is being typed somewhere (the talk's own words): M is a letter then.</summary>
    private bool Typing() => GetViewport().GuiGetFocusOwner() is LineEdit or TextEdit;

    private void OnKey(InputEventKey k)
    {
        Key code = k.PhysicalKeycode;
        if (code is Key.W or Key.A or Key.S or Key.D or Key.Up or Key.Down or Key.Left or Key.Right)
        {
            if (k.Pressed) held.Add(code);
            else held.Remove(code);
            return;
        }
        if (!k.Pressed || k.Echo) return;
        if (code is Key.M or Key.E or Key.Escape)
        {
            if (OwnKeys) Close();
            return;
        }
        long ch = k.Unicode;
        if (ch == '+' || ch == '=' || k.Keycode is Key.Plus or Key.Equal or Key.KpAdd) ZoomBy(1.5f);
        else if (ch == '-' || k.Keycode is Key.Minus or Key.KpSubtract) ZoomBy(1 / 1.5f);
        else if (code == Key.C)
        {
            pan = Vector2.Zero;
            Render();
        }
        else
        {
            int n = code is >= Key.Key1 and <= Key.Key9 ? (int)(code - Key.Key1) : code is >= Key.Kp1 and <= Key.Kp9 ? (int)(code - Key.Kp1) : -1;
            if (n >= 0 && n < listed.Count)
            {
                var me = Me();
                pan = city.Px(listed[n].X, listed[n].Z) - city.Px(me.X, me.Y);
                Render();
            }
        }
    }

    private void ZoomBy(float f)
    {
        zoom = Math.Clamp(zoom * f, 0.25f, 4);
        Render();
    }

    /// <summary>The cursor on the map's paper, in its own px (the paper's slight turn taken out).</summary>
    private Vector2 OnCanvas() => canvas.GetGlobalTransformWithCanvas().AffineInverse() * mouse;

    /// <summary>The key's line under the cursor: -1 the heading, 0.. a kind, -2 none.</summary>
    private int KeyRow()
    {
        var p = OnCanvas() - keyBox.Position;
        if (p.X < 0 || p.Y < 0 || p.X > keyBox.Size.X || p.Y > keyBox.Size.Y) return -2;
        if (p.Y < 3 + HeadH) return -1;
        if (folded) return -2;
        int row = (int)MathF.Floor((p.Y - (3 + HeadH + 3)) / RowH) - 2;
        return row >= 0 && row < MapIcons.Cats.Length ? row : -2;
    }

    /// <summary>A click on the key: its heading folds it away, a kind's line shows or hides that kind.</summary>
    private bool ClickKey()
    {
        var p = OnCanvas() - keyBox.Position;
        if (p.X < 0 || p.Y < 0 || p.X > keyBox.Size.X || p.Y > keyBox.Size.Y) return false;
        int row = KeyRow();
        if (row == -1)
        {
            folded = !folded;
            PlaceKey();
        }
        else if (row >= 0)
        {
            string id = MapIcons.Cats[row].Id;
            if (!hidden.Remove(id)) hidden.Add(id);
            SaveHidden();
        }
        Render();
        return true;
    }

    public override void _Process(double delta)
    {
        float du = 0, dv = 0;
        if (held.Contains(Key.W) || held.Contains(Key.Up)) dv -= 1;
        if (held.Contains(Key.S) || held.Contains(Key.Down)) dv += 1;
        if (held.Contains(Key.A) || held.Contains(Key.Left)) du -= 1;
        if (held.Contains(Key.D) || held.Contains(Key.Right)) du += 1;
        redrawT -= delta;
        if (du != 0 || dv != 0)
        {
            float k = zoom * 0.5f;
            pan += new Vector2(du, dv) * (420 * (float)delta / k);
            Render();
        }
        else if (redrawT <= 0) Render(); // the people with work walk about
    }

    /// <summary>Draw the map again (at the next frame's drawing).</summary>
    private void Render()
    {
        redrawT = 0.5;
        canvas.QueueRedraw();
        keyBox.QueueRedraw();
        side.QueueRedraw();
        PlaceQuill();
    }

    // ------------------------------------------------------------------ Jef

    /// <summary>Where Jef stands, (x, z).</summary>
    private static Vector2 Me()
    {
        var p = GameState.I.Pos;
        return new Vector2(p.X, p.Z);
    }

    /// <summary>The screen angle (0 = east, y down) of where Jef looks, on a north-up map.</summary>
    private float LookAngle()
    {
        Vector3 f = Main.I.Cam is { } cam ? -cam.GlobalBasis.Z : Vector3.Forward;
        if (f.X * f.X + f.Z * f.Z < 1e-6f && Main.I.Cam is { } c2) f = c2.GlobalBasis.Y; // straight down: the top of his view
        float ae = f.X * city.Sin + f.Z * city.Cos, an = f.X * city.Cos - f.Z * city.Sin;
        return MathF.Atan2(-an, ae);
    }

    /// <summary>The way from Jef in plain words: "north-east".</summary>
    private string Way(float dx, float dz)
    {
        var en = city.En(dx, dz);
        int i = (int)MathF.Round(MathF.Atan2(en.X, en.Y) / (MathF.PI / 4));
        return new[] { "north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west" }[(i + 8) % 8];
    }

    /// <summary>A distance the way the arrow and the list show it: 5 m steps near, 10 m steps far.</summary>
    public static string Metres(float d) => $"{(d < 100 ? Math.Max(5, MathF.Floor(d / 5 + 0.5f) * 5) : MathF.Floor(d / 10 + 0.5f) * 10)} m";

    // ------------------------------------------------------------------ the marks

    private static readonly (Regex Re, string Icon)[] PlaceIcons =
    {
        (new("^(tavern|kroeg):"), "tankard"),
        (new("^(dealer_shop|velo_shop|cart_shop)$"), ""),
        (new("^market:"), "market"),
        (new("^post_office$"), "letter"),
        (new("^guardroom:"), "police"),
        (new("^logement$"), "bed"),
        (new("^mill_"), "mill"),
        (new("^landmark:oostershuis$"), "hall"),
        (new("^pump:"), "pump"),
    };

    /// <summary>game/rowing.ts mapMarks: the stairs where boats are for hire.</summary>
    private static List<MapMark> Landings(JsonElement w)
    {
        var o = new List<MapMark>();
        if (w.ValueKind != JsonValueKind.Object || !w.TryGetProperty("landings", out var ls) || ls.ValueKind != JsonValueKind.Array) return o;
        foreach (var l in ls.EnumerateArray())
        {
            if (!l.TryGetProperty("top", out var top) || !l.TryGetProperty("label", out var label)) continue;
            o.Add(new MapMark(top[0].GetSingle(), top[1].GetSingle(), $"boats for hire ({Regex.Replace(label.GetString() ?? "", "^the ", "")})", "shop", null, "boat"));
        }
        return o;
    }

    /// <summary>The posts of the Rijnkaai's own people by day (game/people.ts).</summary>
    private Vector2? PostOf(string id) => id switch
    {
        "sooi" => city.DoorSpot("hessenatie", 1.6f, -2.2f),
        "peeters" => city.DoorSpot("peeters", 1.3f, -2.0f),
        "tuur" => new Vector2(8.0f, -7.4f),
        "fientje" => new Vector2(45.2f, 10.2f),
        _ => null,
    };

    /// <summary>Where a person with work stands: where the people's part has him, else his post, else the town's spot for him.</summary>
    private Vector2? Person(string id)
    {
        if (PersonAt?.Invoke(id) is { } at) return at;
        if (PostOf(id) is { } post) return post;
        if (town is { } t && t.TryGetProperty("employers", out var es))
            foreach (var e in es.EnumerateArray())
                if (e.GetProperty("id").GetString() == id && e.TryGetProperty("spot", out var sp) && city.Spots.TryGetValue(sp.GetString() ?? "", out var s))
                    return new Vector2(s.X, s.Z);
        return null;
    }

    private static Vector2? At(JsonElement e) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty("x", out var x) && e.TryGetProperty("z", out var z) && x.ValueKind == JsonValueKind.Number && z.ValueKind == JsonValueKind.Number ? new Vector2(x.GetSingle(), z.GetSingle()) : null;

    /// <summary>
    /// The job's marks from the store alone (no part runs the job yet): the first job in hand at the place its work
    /// starts, "then:" where it ends, the other jobs in hand numbered. The part that runs the job sets JobMarks and
    /// names the step as the task card does.
    /// </summary>
    private IEnumerable<MapMark> StoreJobMarks()
    {
        int n = 0;
        foreach (var j in GameState.I.Jobs.Where(j => j.Status == "taken"))
        {
            n++;
            if (j.Task is not { ValueKind: JsonValueKind.Object } t) continue;
            Vector2? start = null, end = null;
            string endLabel = "";
            (string Label, float X, float Z) s;
            if (t.TryGetProperty("from", out var from))
            {
                if (from.ValueKind == JsonValueKind.String && city.Spots.TryGetValue(from.GetString()!, out s)) start = new Vector2(s.X, s.Z);
                else start = At(from);
            }
            if (start == null && t.TryGetProperty("post", out var post))
            {
                if (post.ValueKind == JsonValueKind.String && city.Spots.TryGetValue(post.GetString()!, out s)) start = new Vector2(s.X, s.Z);
                else start = At(post);
            }
            if (start == null && t.TryGetProperty("pole", out var pole)) start = At(pole);
            if (t.TryGetProperty("to", out var to) && to.ValueKind == JsonValueKind.String && city.Spots.TryGetValue(to.GetString()!, out s))
            {
                end = new Vector2(s.X, s.Z);
                endLabel = s.Label;
            }
            if (n == 1)
            {
                if ((start ?? end) is { } g) yield return new MapMark(g.X, g.Y, j.Title.Length <= 60 ? j.Title : j.Title[..60], "goal", $"{j.Title}, for {j.EmployerName}");
                if (start is { } a && end is { } b && a.DistanceTo(b) >= 4) yield return new MapMark(b.X, b.Y, $"then: {endLabel}", "goal", $"where {j.Title} ends");
            }
            else if ((start ?? end) is { } g) yield return new MapMark(g.X, g.Y, $"{n}: {j.Title}", "goal", $"for {j.EmployerName}; J to follow it");
        }
    }

    /// <summary>The town's shops and taverns, and its other places a player goes to (game/jobs.ts mapMarks): made once, when the town comes.</summary>
    private static List<MapMark> TownMarks(JsonElement t)
    {
        var o = new List<MapMark>();
        if (t.TryGetProperty("shops", out var shops))
            foreach (var sh in shops.EnumerateArray())
            {
                string label = sh.GetProperty("label").GetString() ?? "";
                var door = sh.GetProperty("door");
                o.Add(new MapMark(door[0].GetSingle(), door[1].GetSingle(), label, "shop", null, MapIcons.IconFor(label)));
            }
        if (t.TryGetProperty("places", out var places))
            foreach (var pl in places.EnumerateObject())
            {
                int r = Array.FindIndex(PlaceIcons, p => p.Re.IsMatch(pl.Name));
                if (r < 0 || At(pl.Value) is not { } at) continue;
                string label = pl.Value.GetProperty("label").GetString() ?? pl.Name;
                o.Add(new MapMark(at.X, at.Y, label, "shop", null, PlaceIcons[r].Icon != "" ? PlaceIcons[r].Icon : MapIcons.IconFor(label)));
            }
        return o;
    }

    /// <summary>What the paper map marks (game/jobs.ts mapMarks and the parts that add theirs): the job's goal, people with work, the board, bed and shops.</summary>
    private List<MapMark> AllMarks()
    {
        var o = new List<MapMark>();
        try
        {
            o.AddRange(JobMarks?.Invoke() ?? StoreJobMarks());
        }
        catch (Exception e)
        {
            GD.PrintErr($"the map's job marks failed: {e.Message}");
        }
        // the work offered, one mark a man, with what he offers (the list beside the map shows it)
        var offers = new Dictionary<string, (string Name, List<string> Titles)>();
        foreach (var j in GameState.I.Jobs)
        {
            if (j.Status != "offered" || !j.Playable) continue;
            if (!offers.TryGetValue(j.EmployerNpc, out var of)) offers[j.EmployerNpc] = of = (j.EmployerName, new List<string>());
            of.Titles.Add(j.Title);
        }
        foreach (var (id, of) in offers)
            if (Person(id) is { } at) o.Add(new MapMark(at.X, at.Y, $"work: {of.Name}", "work", string.Join("; ", of.Titles)));
        var board = city.DoorSpot("hessenatie", 3.2f, 5);
        o.Add(new MapMark(board.X, board.Y, "hiring board", "place", null, "board"));
        var doss = city.DoorSpot("doss", 1.2f);
        o.Add(new MapMark(doss.X, doss.Y, "doss house", "bed", null, "bed"));
        foreach (var (id, label) in new[] { ("fientje", "Fientje's fish"), ("peeters", "the chandlery"), ("tuur", "Tuur's jenever") })
            if (!offers.ContainsKey(id) && Person(id) is { } at) o.Add(new MapMark(at.X, at.Y, label, "shop", null, MapIcons.IconFor(label)));
        // the town's shops and taverns, and its other places a player goes to
        o.AddRange(townMarks);
        o.AddRange(landings);
        foreach (var src in sources)
        {
            try
            {
                o.AddRange(src());
            }
            catch (Exception e)
            {
                GD.PrintErr($"a part's map marks failed: {e.Message}");
            }
        }
        return o;
    }

    /// <summary>Every mark, the landmarks with them (a town place near a landmark is that landmark), shown or not.</summary>
    private List<MapMark> MarksWithSights()
    {
        var all = AllMarks();
        var sights = city.Sights.Where(l => !all.Any(m => CatOf(m) == "sight" && new Vector2(m.X - l.X, m.Z - l.Z).Length() < 30)).ToList();
        all.AddRange(sights);
        return all;
    }

    private List<MapMark> ShownMarks() => MarksWithSights().Where(m => !hidden.Contains(CatOf(m))).ToList();

    // ------------------------------------------------------------------ the way on foot (T4)

    /// <summary>
    /// The way on foot to the followed job's goal (Ways.Path: the townspeople's ways): found again when the goal
    /// changes or Jef is 12 m from where it was asked, at most every 1.5 s, on another thread. The points Jef has
    /// passed are left out (the way from the nearest point on).
    /// </summary>
    private List<Vector2>? WayNow(List<MapMark> marks)
    {
        Vector2? goal = WayGoal != null ? WayGoal() : marks.FirstOrDefault(m => m.Kind == "goal") is { } gm ? new Vector2(gm.X, gm.Z) : null;
        if (goal is not { } g)
        {
            way = null;
            return null;
        }
        var me = Me();
        bool same = way is { } w0 && w0.Goal.DistanceTo(g) < 2;
        double now = Time.GetTicksMsec() / 1000.0;
        if ((!same || way!.Value.Asked.DistanceTo(me) > 12) && !wayBusy && now - wayAt > 1.5)
        {
            wayBusy = true;
            wayAt = now;
            Task.Run(() => Ways.Path(me, g)).ContinueWith(t => Callable.From(() =>
            {
                wayBusy = false;
                var pts = t.Status == TaskStatus.RanToCompletion ? t.Result : null;
                way = (pts is { Count: > 1 } ? pts : null, g, me);
                if (Open) Render();
            }).CallDeferred());
        }
        if (!same || way!.Value.Pts is not { } p) return null;
        int best = 0;
        float bd = float.PositiveInfinity;
        for (int i = 0; i < p.Count; i++)
        {
            float d = p[i].DistanceTo(me);
            if (d < bd)
            {
                bd = d;
                best = i;
            }
        }
        var o = new List<Vector2> { me };
        o.AddRange(p.Skip(Math.Min(best + 1, p.Count - 1)));
        return o;
    }

    /// <summary>The way drawn in dotted ink, with a pale edge so it reads on the red blocks.</summary>
    private static void DrawWay(CanvasItem g, IReadOnlyList<Vector2> pts, float w)
    {
        if (pts.Count < 2) return;
        g.DrawPolyline(pts.ToArray(), PaleWay, w + 3, true);
        foreach (var p in new[] { pts[0], pts[^1] }) g.DrawCircle(p, (w + 3) / 2, PaleWay, true, -1, true);
        Color ink = KindInk["goal"];
        float on = w * 2.2f, off = w * 1.8f, left = on;
        bool draw = true;
        var piece = new List<Vector2> { pts[0] };
        void End()
        {
            if (draw && piece.Count > 1)
            {
                g.DrawPolyline(piece.ToArray(), ink, w, true);
                g.DrawCircle(piece[0], w / 2, ink, true, -1, true);
                g.DrawCircle(piece[^1], w / 2, ink, true, -1, true);
            }
        }
        for (int i = 1; i < pts.Count; i++)
        {
            Vector2 a = pts[i - 1], b = pts[i];
            float len = a.DistanceTo(b), at = 0;
            while (len - at > left)
            {
                at += left;
                var p = a.Lerp(b, at / len);
                piece.Add(p);
                End();
                draw = !draw;
                left = draw ? on : off;
                piece = new List<Vector2> { p };
            }
            left -= len - at;
            piece.Add(b);
        }
        End();
    }

    // ------------------------------------------------------------------ drawing: the paper and the map

    private void PaintPaper(MapSheet g)
    {
        var box = new StyleBoxFlat { BgColor = Paper, ShadowColor = new Color(0, 0, 0, 0.5f), ShadowSize = 20, ShadowOffset = new Vector2(0, 6), AntiAliasing = true };
        box.SetCornerRadiusAll(1);
        g.DrawStyleBox(box, new Rect2(Vector2.Zero, g.Size));
        float inner = g.Size.X - 24;
        g.DrawMultilineString(Fonts.Hand, new Vector2(12, 12 + mapH + 6 + Fonts.Hand.GetAscent(14)), keysText, HorizontalAlignment.Right, inner, 14, -1, new Color(Ink, 0.9f));
    }

    /// <summary>A mark's badge, `s` times its size; `n` its number in the list.</summary>
    private static void DrawMark(CanvasItem g, MapMark m, Vector2 at, float s, int n = 0)
    {
        MapIcons.DrawBadge(g, IconOf(m), at, s);
        if (n <= 0) return;
        var c = at + new Vector2(11 * s, -10 * s);
        g.DrawCircle(c, 7 * s, KindInk[m.Kind], true, -1, true);
        int size = Mathf.RoundToInt(11 * s);
        var font = Fonts.PrintBold;
        string t = n.ToString();
        float w = font.GetStringSize(t, HorizontalAlignment.Left, -1, size).X;
        g.DrawString(font, new Vector2(c.X - w / 2, c.Y + 0.5f * s + (font.GetAscent(size) - font.GetDescent(size)) / 2), t, HorizontalAlignment.Left, -1, size, MapIcons.PaperDisc);
    }

    private sealed class Placed
    {
        public MapMark M = null!;
        public Vector2 At;
        public float S;
        public int N;
        public float? Edge;
        public bool Dot;
    }

    private void PaintMap(MapSheet g)
    {
        var clock = Stopwatch.StartNew();
        float W = mapW, H = mapH;
        var me = Me();
        var j = city.Px(me.X, me.Y);
        Vector2 p0 = j + pan;
        float k = zoom * 0.5f; // screen px per stored px
        // off the traced map: the river to the west, blank paper elsewhere
        g.DrawRect(new Rect2(0, 0, W, H), OffMap);
        g.DrawRect(new Rect2(0, 0, Math.Max(0, W / 2 - p0.X * k), H), River);
        g.DrawTextureRect(baseTex, new Rect2(W / 2 - p0.X * k, H / 2 - p0.Y * k, city.Width * k, city.Height * k), false);
        Vector2 S(float x, float z) => new Vector2(W / 2, H / 2) + (city.Px(x, z) - p0) * k;

        double t0 = clock.Elapsed.TotalMilliseconds;
        var marks = ShownMarks();
        partMs[0] = clock.Elapsed.TotalMilliseconds - t0;
        float Dist(MapMark m) => new Vector2(m.X - me.X, m.Z - me.Y).Length();
        // the way on foot to the followed job, under the marks
        var wp = hidden.Contains("job") ? null : WayNow(marks);
        if (wp != null) DrawWay(g, wp.Select(p => S(p.X, p.Y)).ToList(), 3.5f);
        // the list's order: your job first, then the nearest work, then what goes on in town
        int Rank(MapMark m) => m.Kind == "goal" ? 0 : m.Kind == "work" ? 1 : 2;
        var quests = marks.Where(Quest).OrderBy(Rank).ThenBy(Dist).ToList();
        listed = quests.Take(9).ToList();
        var rest = marks.Where(m => !Quest(m)).ToList();
        // nothing written over anything else: the key, the compass and the scale bar take their room first, then
        // the marks, then your job's step; the street names only where there is still room
        var taken = new List<Rect2>
        {
            Box(W - keyBox.Size.X - 16, H - keyBox.Size.Y - 16, W, H),
            Box(W - 50, 0, W, 34),
            Box(0, H - 44, 130, H),
        };
        bool Room(float x, float y, float w, float h) => !taken.Any(t => x < t.End.X && x + w > t.Position.X && y < t.End.Y && y + h > t.Position.Y);
        void Label(string text, Vector2 at, Font font, int size, float gap, Color ink, bool center = false)
        {
            float w = font.GetStringSize(text, HorizontalAlignment.Left, -1, size).X;
            float u = at.X, v = at.Y;
            var spots = center
                ? new[] { new Vector2(u - w / 2, v - 9), new Vector2(u - w / 2, v - 26), new Vector2(u - w / 2, v + 8) }
                : new[] { new Vector2(u + gap, v - 9), new Vector2(u - gap - w, v - 9), new Vector2(u - w / 2, v - gap - 17), new Vector2(u - w / 2, v + gap) };
            foreach (var sp in spots)
            {
                if (!(Room(sp.X, sp.Y, w, 17) && sp.X > 2 && sp.X + w < W - 2 && sp.Y > 2 && sp.Y + 17 < H - 2)) continue;
                taken.Add(new Rect2(sp.X, sp.Y, w, 17));
                // a pale edge so the ink reads on the red blocks
                var bl = (sp + new Vector2(0, 14)).Round();
                foreach (var off in Edge) g.DrawString(font, bl + off, text, HorizontalAlignment.Left, -1, size, PaleEdge);
                g.DrawString(font, bl, text, HorizontalAlignment.Left, -1, size, ink);
                return;
            }
        }
        bool Inside(Vector2 p) => p.X > -12 && p.X < W + 12 && p.Y > -12 && p.Y < H + 12;
        // where each mark goes: the work at the paper's edge when it is off it; the other places moved a little off
        // one another, and where there is no room at all (zoomed far out) a dot of their kind's colour
        var placed = new List<Placed>();
        bool Free(Vector2 p, float r) => !placed.Any(q => q.At.DistanceTo(p) < r + (q.Dot ? 3 : 11 * q.S) - 1);
        for (int i = 0; i < listed.Count; i++)
        {
            var m = listed[i];
            var p = S(m.X, m.Z);
            var c = new Vector2(Math.Clamp(p.X, 22, W - 22), Math.Clamp(p.Y, 22, H - 22));
            placed.Add(new Placed { M = m, At = c, S = 1.15f, N = i + 1, Edge = c != p ? MathF.Atan2(p.Y - c.Y, p.X - c.X) : null });
        }
        foreach (var m in quests.Skip(9))
        {
            var p = S(m.X, m.Z);
            if (Inside(p)) placed.Add(new Placed { M = m, At = p, S = 1 });
        }
        foreach (var m in rest.OrderBy(m => m.Kind == "shop" ? 1 : 0))
        {
            var p = S(m.X, m.Z);
            if (!Inside(p)) continue;
            float s = m.Kind == "shop" ? 0.85f : 0.95f;
            float r = 11 * s;
            Vector2? at = Free(p, r) ? p : null;
            for (int q = 0; at == null && q < 8; q++)
            {
                float a = q * MathF.PI / 4;
                var np = p + new Vector2(MathF.Cos(a), MathF.Sin(a)) * (r * 1.9f);
                if (Free(np, r)) at = np;
            }
            placed.Add(at is { } ok ? new Placed { M = m, At = ok, S = s } : new Placed { M = m, At = p, S = s, Dot = true });
        }
        foreach (var p in placed)
        {
            float r = p.Dot ? 4 : 12 * p.S;
            taken.Add(Box(p.At.X - r, p.At.Y - r, p.At.X + r + (p.N > 0 ? 8 : 0), p.At.Y + r));
        }
        // your job's step, written by its mark
        foreach (var p in placed)
            if (p.M.Kind == "goal" && !p.Dot) Label(p.M.Label, p.At, Fonts.HandBold, 15, 17, KindInk["goal"]);
        // the squares, quays, water and gates, where there is room
        if (!hidden.Contains("names"))
            foreach (var (name, x, z, big) in city.PlaceNames)
            {
                var p = S(x, z);
                if (Inside(p)) Label(name, p, big ? Fonts.PrintBold : PrintItalic, 15, 0, Ink, true);
            }
        partMs[1] = clock.Elapsed.TotalMilliseconds - t0 - partMs[0];
        // the things that move, under the marks: a small dark dart each, its name on hover
        hits.Clear();
        foreach (var mv in movers)
        {
            var p = S(mv.X, mv.Z);
            if (!Inside(p)) continue;
            float ae = MathF.Sin(mv.Yaw) * city.Sin + MathF.Cos(mv.Yaw) * city.Cos, an = MathF.Sin(mv.Yaw) * city.Cos - MathF.Cos(mv.Yaw) * city.Sin;
            g.DrawSetTransform(p, MathF.Atan2(-an, ae), Vector2.One);
            var dart = new[] { new Vector2(8, 0), new Vector2(-6, -5), new Vector2(-3, 0), new Vector2(-6, 5) };
            g.DrawPolyline(dart.Append(dart[0]).ToArray(), MapIcons.PaperDisc, 2.5f, true);
            g.DrawColoredPolygon(dart, MapIcons.CatInk("service"));
            g.DrawSetTransform(Vector2.Zero);
            hits.Add((p, 8, new MapMark(mv.X, mv.Z, mv.Label, "place", mv.Kind, "boat")));
        }
        // the marks, the work last (on top)
        for (int i = placed.Count - 1; i >= 0; i--)
        {
            var p = placed[i];
            if (p.N > 0) continue;
            if (p.Dot)
            {
                g.DrawCircle(p.At, 3.5f, MapIcons.CatInk(CatOf(p.M)), true, -1, true);
                hits.Add((p.At, 5, p.M));
            }
            else
            {
                DrawMark(g, p.M, p.At, p.S);
                hits.Add((p.At, 11 * p.S + 1, p.M));
            }
        }
        for (int i = placed.Count - 1; i >= 0; i--)
        {
            var p = placed[i];
            if (p.N <= 0) continue;
            DrawMark(g, p.M, p.At, p.S, p.N);
            hits.Add((p.At, 11 * p.S + 2, p.M));
            if (p.Edge is { } edge)
            {
                g.DrawSetTransform(p.At + new Vector2(MathF.Cos(edge), MathF.Sin(edge)) * 18, edge, Vector2.One);
                g.DrawColoredPolygon(new[] { new Vector2(7, 0), new Vector2(-4, -6), new Vector2(-4, 6) }, KindInk[p.M.Kind]);
                g.DrawSetTransform(Vector2.Zero);
            }
        }
        // you: an arrow pointing where you look
        var you = S(me.X, me.Y);
        if (Inside(you))
        {
            g.DrawSetTransform(you, LookAngle(), Vector2.One);
            var pen = new Pen(g, MapIcons.Ink("efe6cc")) { LineWidth = 2.5f };
            pen.BeginPath();
            pen.MoveTo(15, 0);
            pen.LineTo(-10, -9);
            pen.LineTo(-5, 0);
            pen.LineTo(-10, 9);
            pen.ClosePath();
            pen.Stroke();
            pen.Colour = MapIcons.Ink("101010");
            pen.Fill();
            g.DrawSetTransform(Vector2.Zero);
        }
        // compass and scale
        g.DrawString(Fonts.PrintBold, new Vector2(W - 44, 26), "N", HorizontalAlignment.Left, -1, 16, Ink);
        float ax = W - 44 + Fonts.PrintBold.GetStringSize("N ", HorizontalAlignment.Left, -1, 16).X + 5;
        g.DrawLine(new Vector2(ax, 26), new Vector2(ax, 13), Ink, 1.4f, true);
        g.DrawPolyline(new[] { new Vector2(ax - 4, 17.5f), new Vector2(ax, 13), new Vector2(ax + 4, 17.5f) }, Ink, 1.4f, true);
        float bar = 100 * MapBase.Scale * k;
        g.DrawRect(new Rect2(16, H - 22, bar, 4), Ink);
        g.DrawString(Fonts.Print, new Vector2(16, H - 28), "100 m", HorizontalAlignment.Left, -1, 13, Ink);
        partMs[2] = clock.Elapsed.TotalMilliseconds - t0 - partMs[0] - partMs[1];
        Hover(true);
        clock.Stop();
        paintMs = clock.Elapsed.TotalMilliseconds;
        paintMaxMs = Math.Max(paintMaxMs, paintMs);
        paints++;
    }

    private static Rect2 Box(float a, float b, float c, float e) => new(a, b, c - a, e - b);

    /// <summary>The pale edge round a name: the name drawn eight times a little off, under the ink (the canvas's 3 px stroke).</summary>
    private static readonly Vector2[] Edge = Enumerable.Range(0, 8).Select(i => new Vector2(MathF.Cos(i * MathF.PI / 4), MathF.Sin(i * MathF.PI / 4)) * 1.4f).ToArray();

    /// <summary>Words broken into lines no wider than `width`.</summary>
    private static List<string> Wrap(Font font, int size, string text, float width)
    {
        var lines = new List<string>();
        string line = "";
        foreach (string word in text.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            string tried = line == "" ? word : line + " " + word;
            if (line != "" && font.GetStringSize(tried, HorizontalAlignment.Left, -1, size).X > width)
            {
                lines.Add(line);
                line = word;
            }
            else line = tried;
        }
        if (line != "") lines.Add(line);
        return lines;
    }

    /// <summary>Where a line's baseline lies in a line box `lineH` high that starts at `top` (CSS line-height).</summary>
    private static float Baseline(Font font, int size, float top, float lineH) => top + (lineH - font.GetAscent(size) - font.GetDescent(size)) / 2 + font.GetAscent(size);

    /// <summary>Lines of text in the middle of a column, each `lineH` high; gives back the y under the last.</summary>
    private static float Centred(CanvasItem g, Font font, int size, IReadOnlyList<string> lines, float x, float y, float width, float lineH, Color colour)
    {
        foreach (string line in lines)
        {
            float w = font.GetStringSize(line, HorizontalAlignment.Left, -1, size).X;
            g.DrawString(font, new Vector2(x + (width - w) / 2, Baseline(font, size, y, lineH)), line, HorizontalAlignment.Left, -1, size, colour);
            y += lineH;
        }
        return y;
    }

    // ------------------------------------------------------------------ drawing: the key

    private void PaintKey(MapSheet g)
    {
        var size = g.Size;
        g.DrawRect(new Rect2(Vector2.Zero, size), KeyPaper);
        g.DrawRect(new Rect2(0.5f, 0.5f, size.X - 1, size.Y - 1), Border, false, 1);
        float x = 5, y = 3, w = size.X - 10;
        int row = KeyRow();
        // the heading: a click folds the key away
        if (row == -1) g.DrawRect(new Rect2(x - 2, y - 2, w + 4, HeadH + 4), Hot);
        float bl = y + HeadH / 2 + (Fonts.HandBold.GetAscent(14) - Fonts.HandBold.GetDescent(14)) / 2;
        g.DrawString(Fonts.HandBold, new Vector2(x + 2, bl), "Key", HorizontalAlignment.Left, -1, 14, Ink);
        float kw = Fonts.HandBold.GetStringSize("Key ", HorizontalAlignment.Left, -1, 14).X;
        g.DrawString(Fonts.Hand, new Vector2(x + 2 + kw, bl), "(click to show or hide)", HorizontalAlignment.Left, -1, 11, new Color(Ink, 0.75f));
        if (folded) return;
        y += HeadH;
        g.DrawRect(new Rect2(x, y, w, 1), new Color(Ink, 0.3f));
        y += 3;
        float textBl(float top) => top + RowH / 2 + (Fonts.Hand.GetAscent(13) - Fonts.Hand.GetDescent(13)) / 2;
        const float ks = 20f / 26; // the browser draws each picture in a box of 26 and shows it 20 wide
        Vector2 Pic(float top) => new(x + 2, top + 1);
        // you
        g.DrawSetTransform(Pic(y), 0, new Vector2(ks, ks));
        g.DrawColoredPolygon(new[] { new Vector2(22, 13), new Vector2(5, 6), new Vector2(9, 13), new Vector2(5, 20) }, MapIcons.Ink("101010"));
        g.DrawSetTransform(Vector2.Zero);
        g.DrawString(Fonts.Hand, new Vector2(x + 28, textBl(y)), "you", HorizontalAlignment.Left, -1, 13, Ink);
        y += RowH;
        // the way
        g.DrawSetTransform(Pic(y), 0, new Vector2(ks, ks));
        DrawWay(g, new[] { new Vector2(3, 13), new Vector2(23, 13) }, 2.5f);
        g.DrawSetTransform(Vector2.Zero);
        g.DrawString(Fonts.Hand, new Vector2(x + 28, textBl(y)), "the way there on foot", HorizontalAlignment.Left, -1, 13, Ink);
        y += RowH;
        for (int i = 0; i < MapIcons.Cats.Length; i++, y += RowH)
        {
            var c = MapIcons.Cats[i];
            bool off = hidden.Contains(c.Id);
            float alpha = off ? 0.4f : 1;
            if (row == i) g.DrawRect(new Rect2(x - 2, y - 2, w + 4, RowH + 4), Hot);
            if (c.Id == "names")
            {
                float tw = Fonts.PrintBold.GetStringSize("Aa", HorizontalAlignment.Left, -1, 10).X;
                g.DrawString(Fonts.PrintBold, new Vector2(x + 2 + 10 - tw / 2, y + 1 + 18 * ks), "Aa", HorizontalAlignment.Left, -1, 10, new Color(Ink, alpha));
            }
            else
            {
                string icon = c.Id == "food" ? "bread" : c.Id == "shop" ? "hat" : c.Id == "sight" ? "church" : MapIcons.Icons.First(ic => ic.Value.Cat == c.Id).Key;
                MapIcons.DrawBadge(g, icon, Pic(y) + new Vector2(10, 10), ks, alpha);
            }
            var at = new Vector2(x + 28, textBl(y));
            g.DrawString(Fonts.Hand, at, c.Label, HorizontalAlignment.Left, -1, 13, new Color(Ink, alpha));
            if (off)
            {
                float tw = Fonts.Hand.GetStringSize(c.Label, HorizontalAlignment.Left, -1, 13).X;
                g.DrawRect(new Rect2(at.X, at.Y - 4.5f, tw, 1), new Color(Ink, alpha));
            }
        }
    }

    // ------------------------------------------------------------------ hover: the name, how far, which way

    private string tipName = "", tipDetail = "", tipSmall = "";
    private List<string> tipA = new(), tipB = new(), tipC = new();
    private const float TipMax = 260;

    /// <summary>The mark under the cursor (the ink cursor while the game holds the mouse, else the real mouse): its name beside it.</summary>
    private void Hover(bool force = false)
    {
        if (!Open) return;
        int row = KeyRow();
        if (row != hotRow)
        {
            hotRow = row;
            keyBox.QueueRedraw();
        }
        (Vector2 At, float R, MapMark M)? hit = null;
        if (mouse.X >= 0 && row == -2)
        {
            var l = OnCanvas();
            float bd = float.PositiveInfinity;
            foreach (var h in hits)
            {
                float d = h.At.DistanceTo(l);
                if (d <= h.R && d < bd)
                {
                    bd = d;
                    hit = h;
                }
            }
        }
        if (!force && hit?.M == hot) return;
        hot = hit?.M;
        hotHit = hit;
        if (hit is not { } hh)
        {
            tip.Visible = false;
            return;
        }
        var m = hh.M;
        var me = Me();
        float dist = new Vector2(m.X - me.X, m.Z - me.Y).Length();
        string kind = MapIcons.Cat[CatOf(m)].Label;
        tipName = m.Label.Length > 0 ? char.ToUpperInvariant(m.Label[0]) + m.Label[1..] : "";
        tipDetail = m.Detail ?? "";
        tipSmall = $"{Metres(dist)} {Way(m.X - me.X, m.Z - me.Y)} · {kind}";
        // its size: at most 260 wide inside, the lines one under the other (line-height 1.2)
        tipA = Wrap(Fonts.HandBold, 15, tipName, TipMax);
        tipB = tipDetail == "" ? new List<string>() : Wrap(HandItalic, 13, tipDetail, TipMax);
        tipC = Wrap(Fonts.Hand, 12, tipSmall, TipMax);
        float widest = tipA.Select(l => Fonts.HandBold.GetStringSize(l, HorizontalAlignment.Left, -1, 15).X)
            .Concat(tipB.Select(l => HandItalic.GetStringSize(l, HorizontalAlignment.Left, -1, 13).X))
            .Concat(tipC.Select(l => Fonts.Hand.GetStringSize(l, HorizontalAlignment.Left, -1, 12).X)).Max();
        float tipW = MathF.Ceiling(Math.Min(TipMax, widest)) + 16;
        float th = MathF.Ceiling(tipA.Count * 18 + tipB.Count * 15.6f + tipC.Count * 14.4f) + 9;
        float left = hh.At.X + hh.R + 6 + tipW > mapW ? hh.At.X - hh.R - 6 - tipW : hh.At.X + hh.R + 6;
        float top = Math.Max(0, Math.Min(mapH - th, hh.At.Y - th / 2));
        tip.Position = new Vector2(Math.Max(0, left), top).Round();
        tip.Size = new Vector2(tipW, th);
        tip.Visible = true;
        tip.QueueRedraw();
    }

    private void PaintTip(MapSheet g)
    {
        var size = g.Size;
        g.DrawRect(new Rect2(1, 2, size.X + 1, size.Y + 1), new Color(0, 0, 0, 0.18f));
        g.DrawRect(new Rect2(Vector2.Zero, size), MapIcons.PaperDisc);
        g.DrawRect(new Rect2(0.5f, 0.5f, size.X - 1, size.Y - 1), Border, false, 1);
        float y = 4, w = size.X - 16;
        y = Centred(g, Fonts.HandBold, 15, tipA, 8, y, w, 18, Ink);
        y = Centred(g, HandItalic, 13, tipB, 8, y, w, 15.6f, new Color(Ink, 0.85f));
        Centred(g, Fonts.Hand, 12, tipC, 8, y, w, 14.4f, new Color(Ink, 0.7f));
    }

    // ------------------------------------------------------------------ drawing: the work beside the map

    /// <summary>The work beside the map, numbered as on it, with how far and which way.</summary>
    private void PaintSide(MapSheet g)
    {
        float w = g.Size.X, y = 0;
        var me = Me();
        bool any = false;
        void Part(string title, string kind)
        {
            var items = listed.Select((m, i) => (m, i)).Where(t => t.m.Kind == kind).ToList();
            if (items.Count == 0) return;
            any = true;
            // h3: 17 px bold, a line under it
            y += 4;
            float h = Fonts.HandBold.GetHeight(17);
            y = Centred(g, Fonts.HandBold, 17, new[] { title }, 0, y, w, h, Ink);
            g.DrawRect(new Rect2(0, y, w, 1), new Color(Ink, 0.4f));
            y += 1 + 4;
            foreach (var (m, i) in items)
            {
                Color ink = KindInk[m.Kind];
                y += 3;
                // the number in bold, then the name, in the middle as one
                string num = $"{i + 1} ";
                float nw = Fonts.HandBold.GetStringSize(num, HorizontalAlignment.Left, -1, 15).X + 4;
                var lines = Wrap(Fonts.Hand, 15, m.Label, w - nw);
                for (int l = 0; l < lines.Count; l++, y += 18.75f)
                {
                    float lw = Fonts.Hand.GetStringSize(lines[l], HorizontalAlignment.Left, -1, 15).X + (l == 0 ? nw : 0);
                    float x = (w - lw) / 2, bl = Baseline(Fonts.Hand, 15, y, 18.75f);
                    if (l == 0)
                    {
                        g.DrawString(Fonts.HandBold, new Vector2(x, bl), num, HorizontalAlignment.Left, -1, 15, ink);
                        x += nw;
                    }
                    g.DrawString(Fonts.Hand, new Vector2(x, bl), lines[l], HorizontalAlignment.Left, -1, 15, ink);
                }
                if (!string.IsNullOrEmpty(m.Detail)) y = Centred(g, HandItalic, 13, Wrap(HandItalic, 13, m.Detail, w - 18), 18, y, w - 18, 16.25f, new Color(Ink, 0.85f));
                y = Centred(g, Fonts.Hand, 13, new[] { $"{Metres(new Vector2(m.X - me.X, m.Z - me.Y).Length())} {Way(m.X - me.X, m.Z - me.Y)}" }, 18, y, w - 18, 16.25f, new Color(Ink, 0.7f));
                y += 5;
                for (float x = 0; x < w; x += 6) g.DrawRect(new Rect2(x, y, 3, 1), new Color(Ink, 0.25f));
                y += 1;
            }
            y += 10;
        }
        Part("Your job", "goal");
        Part("Work offered", "work");
        Part("Going on in town", "event");
        if (!any)
        {
            y += 15;
            Centred(g, Fonts.Hand, 15, Wrap(Fonts.Hand, 15, "No work in hand and none offered near. Try the hiring board.", w), 0, y, w, Fonts.Hand.GetHeight(15), new Color(Ink, 0.8f));
        }
    }

    // ------------------------------------------------------------------ the ink cursor (game/cursor.ts)

    private void PlaceQuill()
    {
        quill.Visible = inkOn && Open;
        if (!quill.Visible) return;
        quill.Position = mouse - new Vector2(2, 2);
        bool dip = hot != null || hotRow != -2;
        quill.PivotOffset = new Vector2(2, 2);
        quill.RotationDegrees = dip ? -8 : 0;
        quill.Scale = dip ? new Vector2(1.06f, 1.06f) : Vector2.One;
    }

    private void PaintQuill(MapSheet g)
    {
        g.DrawSetTransform(Vector2.Zero, 0, new Vector2(1.2f, 1.2f));
        Color ink = new("2a241c");
        var pen = new Pen(g, new Color("efe6cf")) { LineWidth = 1.5f };
        pen.BeginPath();
        pen.MoveTo(1.5f, 1.5f);
        pen.BezierCurveTo(6, 3, 10, 5.5f, 14, 9);
        pen.BezierCurveTo(19, 13.5f, 24, 20, 28.5f, 28.5f);
        pen.BezierCurveTo(21, 25, 13.5f, 19.5f, 8.5f, 14);
        pen.BezierCurveTo(5, 10.2f, 2.8f, 6, 1.5f, 1.5f);
        pen.Fill();
        pen.Colour = ink;
        pen.Stroke();
        g.DrawLine(new Vector2(1.5f, 1.5f), new Vector2(21, 21), ink, 1.1f, true);
        Color barb = new(ink, 0.55f);
        foreach (var (a, b) in new[] { (new Vector2(9, 7.5f), new Vector2(6.8f, 11)), (new Vector2(13.2f, 11.2f), new Vector2(10.8f, 15)), (new Vector2(17.2f, 15.2f), new Vector2(14.8f, 19)), (new Vector2(21, 19.6f), new Vector2(18.8f, 23)) })
            g.DrawLine(a, b, barb, 0.8f, true);
        g.DrawColoredPolygon(new[] { new Vector2(1.5f, 1.5f), new Vector2(5.2f, 2.9f), new Vector2(2.9f, 5.2f) }, ink);
        g.DrawSetTransform(Vector2.Zero);
    }

    // ------------------------------------------------------------------ for the checks

    /// <summary>What the map shows now (the self-test, a later check).</summary>
    public Dictionary<string, object?> Info()
    {
        var all = city == null ? new List<MapMark>() : MarksWithSights();
        return new Dictionary<string, object?>
        {
            ["open"] = Open,
            ["zoom"] = zoom,
            ["pan"] = new[] { pan.X, pan.Y },
            ["map_px"] = new[] { mapW, mapH },
            ["hidden"] = MapIcons.Cats.Where(c => hidden.Contains(c.Id)).Select(c => c.Id).ToArray(),
            ["places_per_kind"] = MapIcons.Cats.Where(c => c.Id != "names").ToDictionary(c => c.Id, c => all.Count(m => CatOf(m) == c.Id)),
            ["places"] = all.Count,
            ["names"] = city?.PlaceNames.Count ?? 0,
            ["drawn"] = hits.Count,
            ["listed"] = listed.Select(m => $"{m.Kind}: {m.Label}").ToArray(),
            ["hover"] = hot == null ? null : new[] { tipName, tipDetail, tipSmall },
            ["movers"] = movers.Count,
            ["town_places_in"] = town != null,
            ["paint_ms_last"] = Math.Round(paintMs, 3),
            ["paint_ms_max"] = Math.Round(paintMaxMs, 3),
            ["paint_ms_parts"] = partMs.Select(v => Math.Round(v, 3)).ToArray(),
            ["badges_from_one_picture"] = MapIcons.AtlasReady,
            ["paints"] = paints,
        };
    }

    /// <summary>Where a drawn mark is in the window, by the start of its name (the self-test points the mouse there), or null.</summary>
    public Vector2? OnScreen(string label)
    {
        foreach (var h in hits)
            if (h.M.Label.StartsWith(label, StringComparison.OrdinalIgnoreCase)) return canvas.GetGlobalTransformWithCanvas() * h.At;
        return null;
    }

    /// <summary>Where a kind's line of the key is in the window (the self-test clicks there).</summary>
    public Vector2? KeyLineOnScreen(string cat)
    {
        int i = Array.FindIndex(MapIcons.Cats, c => c.Id == cat);
        if (i < 0 || folded || canvas == null) return null;
        return canvas.GetGlobalTransformWithCanvas() * (keyBox.Position + new Vector2(60, 3 + HeadH + 3 + RowH * (i + 2) + RowH / 2));
    }

    /// <summary>A square, quay, water or gate of the map by its name (x, z), or null.</summary>
    public Vector2? NamedPlace(string name)
    {
        if (city == null) return null;
        foreach (var (n, x, z, _) in city.PlaceNames)
            if (string.Equals(n, name, StringComparison.OrdinalIgnoreCase)) return new Vector2(x, z);
        return null;
    }

    /// <summary>A mark by the start of its name, shown or not.</summary>
    public MapMark? Find(string label) => city == null ? null : MarksWithSights().FirstOrDefault(m => m.Label.StartsWith(label, StringComparison.OrdinalIgnoreCase));
}

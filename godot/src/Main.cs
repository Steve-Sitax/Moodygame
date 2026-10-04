using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist;

/// <summary>
/// The game's root: the world drawn small (720 lines by default, the browser's settings) into its own viewport, then
/// full screen through the retro pass. Options after "--": --town path (the baked town), --shots dir (a picture and
/// the frame time at each of the bake's places, then quit).
/// </summary>
public partial class Main : Node
{
    private const int FxLines = 270;
    // the settings (src/Menu/Apply.cs): the lines drawn (0: the full window), the render scale, the PS1 wobble
    private int lines = 720;
    private float renderScale = 1;
    private bool wobble = true;
    private bool psxColour = true;
    /// <summary>The snap grid the psx shaders have now (`psx_snap_res`): coarse with the wobble on, too fine to see with it off.</summary>
    public Vector2 SnapGrid { get; private set; }
    /// <summary>The town is in and the parts are made.</summary>
    public bool Loaded { get; private set; }
    private List<Node> parts = new();

    /// <summary>The running game, for its parts (src/GamePart.cs).</summary>
    public static Main I { get; private set; } = null!;
    /// <summary>The viewport the world is drawn in: 3D nodes go under it.</summary>
    public SubViewport View => view;
    public BakedWorld World => world;
    /// <summary>The camera in use. A part that brings its own (Jef's eyes) sets it and makes it current.</summary>
    public Camera3D Cam { get; set; } = null!;
    /// <summary>Over the picture: the HUD, the dialogs, the menus.</summary>
    public CanvasLayer Ui { get; private set; } = null!;
    /// <summary>Options after "--" on the command line: --name value.</summary>
    private string[]? arguments;
    public string Arg(string k, string d = "")
    {
        var args = arguments ??= OS.GetCmdlineUserArgs();
        int i = Array.IndexOf(args, "--" + k);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : d;
    }
    public bool Flag(string k) => Array.IndexOf(arguments ??= OS.GetCmdlineUserArgs(), "--" + k) >= 0;

    private SubViewport view = null!;
    private TextureRect screen = null!;
    private ShaderMaterial retro = null!;
    /// <summary>Dev picture comparisons hold the screen grain at a fixed instant; -1 restores real time.</summary>
    public void PictureTime(float seconds) => retro.SetShaderParameter("picture_time", seconds);
    private FlyCam cam = null!;
    private BakedWorld world = null!;

    // --shots
    private string shots = "";
    private JsonElement places;
    private int place;
    private int frame;
    private ulong last;
    private readonly List<double> times = new();
    private readonly List<Dictionary<string, object>> rows = new();

    public override void _Ready()
    {
        I = this;
        Dev.FrameCost.InstallContext();
        Paths.Initialize();
        string town = Paths.Town;
        shots = Paths.TestOutput("shots");

        view = new SubViewport { RenderTargetUpdateMode = SubViewport.UpdateMode.Always, Msaa3D = Viewport.Msaa.Disabled, HandleInputLocally = false };
        AddChild(view);
        retro = new ShaderMaterial { Shader = GD.Load<Shader>(Paths.RetroShader) };
        screen = new TextureRect { Texture = view.GetTexture(), ExpandMode = TextureRect.ExpandModeEnum.IgnoreSize, StretchMode = TextureRect.StretchModeEnum.Scale, TextureFilter = CanvasItem.TextureFilterEnum.Nearest, Material = retro, MouseFilter = Control.MouseFilterEnum.Ignore };
        screen.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        AddChild(screen);
        GetViewport().SizeChanged += Resize;

        world = new BakedWorld();
        Ui = new CanvasLayer { Layer = 10 };
        AddChild(Ui);
        // the menus (src/Menu): the settings first (the picture's size), then the loading screen while the town
        // loads; a run that takes its own pictures (--shots, another part's test) has neither
        bool menus = Menu.MainMenu.Wanted(this);
        if (menus) Menu.Apply.Early();
        var boot = menus ? Menu.Loading.Show(this) : null;
        parts = GamePartAttribute.Make(this).ToList();
        // the server needs no town: it comes up while the town loads
        foreach (var part in parts.Where(p => p is Net.ServerLink)) AddChild(part);
        LoadTown(town, boot != null);
    }

    /// <summary>
    /// Read and build the town, then make the parts. With the loading screen up the work is done beside the main
    /// thread (the town is not in the tree yet), so the screen goes on drawing and shows how far it is.
    /// </summary>
    private async void LoadTown(string town, bool beside)
    {
        Error err;
        if (beside)
        {
            // two frames first: the loading screen is on the glass before the work starts
            await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            try
            {
                err = await Task.Run(() => world.Load(town));
            }
            catch (Exception e)
            {
                GD.PrintErr(e.ToString());
                err = Error.Failed;
            }
        }
        else err = world.Load(town);
        view.AddChild(world);
        if (err != Error.Ok)
        {
            GD.PrintErr($"the baked town did not load ({err}): {town}. Bake it: node tools/godot/export-scene.mjs");
            GetTree().Quit(1);
            return;
        }
        GD.Print($"town in: {JsonSerializer.Serialize(world.Report)}");

        var facts = world.Facts.RootElement.GetProperty("facts");
        var c0 = facts.GetProperty("camera");
        cam = new FlyCam { Fov = c0.GetProperty("fov").GetSingle(), Near = Math.Max(0.05f, c0.GetProperty("near").GetSingle()), Far = c0.GetProperty("far").GetSingle(), Current = true };
        view.AddChild(cam);
        Cam = cam;
        places = world.Facts.RootElement.GetProperty("places");
        Go(0);
        Resize();
        if (shots != "")
        {
            DisplayServer.WindowSetVsyncMode(DisplayServer.VSyncMode.Disabled);
            Engine.MaxFps = 0;
        }
        foreach (var part in parts.Where(p => p.GetParent() == null)) AddChild(part);
        Loaded = true;
    }

    /// <summary>
    /// The picture's settings (src/Menu/Apply.cs): the lines the world is drawn at (0: as many as the window has),
    /// times the render scale; the PS1 wobble (corners jump to a coarse grid) and the PS1 colours (32 steps with a
    /// dither, or 256).
    /// </summary>
    public void SetPicture(int lines, float scale, bool wobble, bool psxColour)
    {
        this.lines = lines;
        renderScale = scale;
        this.wobble = wobble;
        this.psxColour = psxColour;
        if (view != null) Resize();
    }

    private void Resize()
    {
        var win = GetViewport().GetVisibleRect().Size;
        if (win.Y < 1) return;
        float aspect = win.X / win.Y;
        // retroPass.ts resize, menu/apply.ts: the chosen lines (never more than the window has), times the scale
        int h = lines > 0 ? (int)Math.Min(lines, win.Y) : (int)win.Y;
        if (renderScale < 0.999f) h = Math.Max(90, (int)MathF.Round(h * renderScale));
        var size = new Vector2I(Math.Max(1, (int)MathF.Round(h * aspect)), h);
        view.Size = size;
        retro.SetShaderParameter("res", new Vector2(size.X, size.Y));
        retro.SetShaderParameter("fx_res", new Vector2(MathF.Round(FxLines * aspect), FxLines));
        retro.SetShaderParameter("levels", psxColour ? 32f : 256f);
        // the snap grid of the 270-line picture, halved (main.ts); wobble off: a grid too fine to see
        SnapGrid = wobble ? new Vector2(MathF.Round(FxLines * aspect) * 0.5f, FxLines * 0.5f) : new Vector2(1e5f, 1e5f);
        RenderingServer.GlobalShaderParameterSet("psx_snap_res", SnapGrid);
    }

    private void Go(int i)
    {
        var p = places[i];
        var pos = p.GetProperty("pos");
        var q = p.GetProperty("quat");
        cam.Position = new Vector3(pos[0].GetSingle(), pos[1].GetSingle(), pos[2].GetSingle());
        cam.Face(new Quaternion(q[0].GetSingle(), q[1].GetSingle(), q[2].GetSingle(), q[3].GetSingle()));
    }

    public override void _Process(double delta)
    {
        Render.UniformUpdates.Global("psx_time", Time.GetTicksMsec() / 1000f);
        if (shots == "" || cam == null) return;
        if (Cam != cam) cam.Current = true; // the pictures are taken from the free camera
        ulong now = Time.GetTicksUsec();
        if (frame > 40) times.Add((now - last) / 1000.0);
        last = now;
        frame++;
        if (frame == 40) GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(shots, $"godot_{places[place].GetProperty("place").GetString()!.Replace(' ', '_')}.png"));
        if (frame > 40) cam.RotateY(Mathf.Tau / 180);
        if (frame < 221) return;
        times.Sort();
        rows.Add(new Dictionary<string, object>
        {
            ["place"] = places[place].GetProperty("place").GetString()!,
            ["mean"] = Math.Round(times.Average(), 3),
            ["p95"] = Math.Round(times[(int)(times.Count * 0.95)], 3),
            ["max"] = Math.Round(times[^1], 3),
            ["drawCalls"] = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalDrawCallsInFrame),
        });
        GD.Print(JsonSerializer.Serialize(rows[^1]));
        times.Clear();
        frame = 0;
        if (++place < places.GetArrayLength())
        {
            Go(place);
            return;
        }
        System.IO.File.WriteAllText(System.IO.Path.Combine(shots, "result.json"), JsonSerializer.Serialize(new { load = world.Report, unported = world.Unported.Distinct().Take(80), rows }, new JsonSerializerOptions { WriteIndented = true }));
        cam = null!;
        GetTree().Quit();
    }
}

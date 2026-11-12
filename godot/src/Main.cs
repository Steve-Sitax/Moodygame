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
    // the settings (src/Menu/Apply.cs): the lines drawn (0: the full window), the render scale
    private int lines = 0;
    private float renderScale = 1;
    /// <summary>The snap grid of the psx shaders (`psx_snap_res`): always too fine to see (Steve, 2026-10-11: no PS1 wobble).</summary>
    public Vector2 SnapGrid { get; private set; }
    /// <summary>The town is in and the parts are made.</summary>
    public bool Loaded { get; private set; }
    private List<Node> parts = new();

    /// <summary>The running game, for its parts (src/GamePart.cs).</summary>
    public static Main I { get; private set; } = null!;
    /// <summary>(#255) A snap run's own clock for the shaders (the waves, the rain's rings): the same at the same frame of a
    /// view in every run, so before and after pictures of a water's edge line up. Null: the real clock.</summary>
    public static float? SnapTime;
    /// <summary>The viewport the world is drawn in: 3D nodes go under it.</summary>
    public SubViewport View => view;
    public BakedWorld World => world;
    /// <summary>The camera in use. A part that brings its own (Jef's eyes) sets it and makes it current.</summary>
    public Camera3D Cam { get; set; } = null!;
    /// <summary>Over the picture: the HUD, the dialogs, the menus.</summary>
    public CanvasLayer Ui { get; private set; } = null!;
    /// <summary>Options after "--" on the command line: --name value.</summary>
    private string[]? arguments;
    private static int ArgumentIndex(string[] args, string k)
    {
        for (int i = 0; i < args.Length; i++) {
            var value = args[i];
            if (value.Length == k.Length + 2 && value[0] == '-' && value[1] == '-'
                && value.AsSpan(2).SequenceEqual(k.AsSpan())) return i;
        }
        return -1;
    }
    public string Arg(string k, string d = "")
    {
        var args = arguments ??= OS.GetCmdlineUserArgs();
        int i = ArgumentIndex(args, k);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : d;
    }
    public bool Flag(string k) => ArgumentIndex(arguments ??= OS.GetCmdlineUserArgs(), k) >= 0;
    internal static object ArgumentLookupProof()
    {
        string[][] cases = { Array.Empty<string>(), new[] { "--a", "value", "--a", "other", "--tail" }, new[] { "a", "--", "---a", "--\u00e9", "--missing-value" } };
        string[] keys = { "", "a", "tail", "\u00e9", "missing", "missing-value", "--a" };
        int checks = 0, differences = 0, referenceSum = 0, cachedSum = 0;
        foreach (var args in cases) foreach (var key in keys) { checks++; if (Array.IndexOf(args, "--" + key) != ArgumentIndex(args, key)) differences++; }
        for (int i = 0; i < 100; i++) ArgumentIndex(cases[1], keys[i % keys.Length]);
        long bytes = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 1000; i++) referenceSum += Array.IndexOf(cases[1], "--" + keys[i % keys.Length]);
        long originalBytes = GC.GetAllocatedBytesForCurrentThread() - bytes;
        bytes = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 1000; i++) cachedSum += ArgumentIndex(cases[1], keys[i % keys.Length]);
        long cachedBytes = GC.GetAllocatedBytesForCurrentThread() - bytes;
        return new { checks, differences, originalBytes, cachedBytes, ok = differences == 0 && referenceSum == cachedSum && cachedBytes == 0 && originalBytes > 0 };
    }

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

    /// <summary>A native district entry point can supply the same game runtime with a saved Godot world.</summary>
    protected virtual BakedWorld CreateWorld() => new();
    protected virtual IEnumerable<Node> CreateParts() => GamePartAttribute.Make(this);
    protected virtual bool UseMenus => Menu.MainMenu.Wanted(this);
    public virtual bool MultiplayerAvailable => true;
    public virtual bool UsesLocalBackend => false;
    public virtual bool DedicatedServer => false;
    public virtual string WorldFingerprint => "";
    public virtual Task<Net.ILocalGameBackend> CreateLocalBackend() => throw new InvalidOperationException("This entry point does not supply local game rules.");
    protected virtual System.Threading.Tasks.Task PrepareWorld() => System.Threading.Tasks.Task.CompletedTask;
    protected virtual Task PrepareWorldLoad() => Task.CompletedTask;

    public override void _Ready()
    {
        Dev.StartupTiming.Mark("main.ready");
        I = this;
        Dev.FrameCost.InstallContext();
        Paths.Initialize();
        string town = Paths.Town;
        shots = Paths.TestOutput("shots");

        if (DedicatedServer)
        {
            // The server needs scene transforms, collisions and navigation, with no player, UI or camera.
            view = new SubViewport { Disable3D = true, RenderTargetUpdateMode = SubViewport.UpdateMode.Disabled };
            AddChild(view);
            world = CreateWorld();
            LoadTown(town, false);
            return;
        }

        // (smooth edges: 4x multisampling; at 4K on the test PC it cost no measurable frame time, 2026-10-11)
        view = new SubViewport { RenderTargetUpdateMode = SubViewport.UpdateMode.Always, Msaa3D = Viewport.Msaa.Msaa4X, HandleInputLocally = false };
        AddChild(view);
        retro = new ShaderMaterial { Shader = GD.Load<Shader>(Paths.RetroShader) };
        screen = new TextureRect { Texture = view.GetTexture(), ExpandMode = TextureRect.ExpandModeEnum.IgnoreSize, StretchMode = TextureRect.StretchModeEnum.Scale, TextureFilter = CanvasItem.TextureFilterEnum.Linear, Material = retro, MouseFilter = Control.MouseFilterEnum.Ignore };
        screen.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        AddChild(screen);
        GetViewport().SizeChanged += Resize;

        world = CreateWorld();
        Ui = new CanvasLayer { Layer = 10 };
        AddChild(Ui);
        // the menus (src/Menu): the settings first (the picture's size), then the loading screen while the town
        // loads; a run that takes its own pictures (--shots, another part's test) has neither
        bool menus = UseMenus;
        if (menus) Menu.Apply.Early();
        var boot = menus ? Menu.Loading.Show(this) : null;
        parts = CreateParts().ToList();
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
        Dev.StartupTiming.Mark("prepare-world-load.begin");
        try { await PrepareWorldLoad(); }
        catch (Exception e) { GD.PrintErr($"The shared town could not be loaded: {e.Message}"); GetTree().Quit(1); return; }
        Dev.StartupTiming.Mark("prepare-world-load.end");
        async Task JoinRuien()
        {
            // Keep the loading frame uncapped until this worker is done too. Restoring
            // VSync after only the town loaded made every remaining Ruien mesh read
            // wait for a display frame (182 s in the complete network's warm proof).
            using (Dev.StartupTiming.Measure("ruien.join"))
                foreach (var early in parts.OfType<World.Ruien.Ruien>())
                    while (!early.Beside.IsCompleted) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
        }
        Error err;
        if (beside && !Flag("load-on-main"))
        {
            // two frames first: the loading screen is on the glass before the work starts
            await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            // Worker resource reads synchronize with the renderer. Do not make each
            // synchronization wait for the monitor refresh or the player's frame cap.
            bool display=DisplayServer.GetName()!="headless";
            var vsync=display?DisplayServer.WindowGetVsyncMode():DisplayServer.VSyncMode.Disabled;
            int frameCap=Engine.MaxFps;
            Engine.MaxFps=0;
            // (the Ruien's globals before the loading thread starts: World/Ruien/Ruien.PrepareEarly)
            if(!Flag("ruien-in-order"))foreach(var ruien in parts.OfType<World.Ruien.Ruien>())ruien.PrepareEarly();
            if(display)DisplayServer.WindowSetVsyncMode(DisplayServer.VSyncMode.Disabled);
            try
            {
                using(Dev.StartupTiming.Measure("world.load")) err = await Task.Run(() => world.Load(town));
                if(err==Error.Ok&&!Flag("startup-capped-ruien-join"))await JoinRuien();
            }
            catch (Exception e)
            {
                GD.PrintErr(e.ToString());
                err = Error.Failed;
            }
            finally
            {
                Engine.MaxFps=frameCap;
                if(display)DisplayServer.WindowSetVsyncMode(vsync);
            }
            // Diagnostic comparison only: reproduce the former loading-frame cap.
            if(err==Error.Ok&&Flag("startup-capped-ruien-join"))await JoinRuien();
        }
        else { using(Dev.StartupTiming.Measure("world.load")) err = world.Load(town); if(err==Error.Ok)await JoinRuien(); }
        if (err != Error.Ok)
        {
            GD.PrintErr($"The town did not load ({err}): {town}");
            GetTree().Quit(1);
            return;
        }
        // The Ruien's worker only ever runs beside the town's loading thread: the main thread's own loads and the
        // town's scripts (from world.ready on) must not run while it still loads (World/Ruien/Ruien.StartBeside).
        using(Dev.StartupTiming.Measure("world.ready")) view.AddChild(world);
        using(Dev.StartupTiming.Measure("prepare-world")) await PrepareWorld();
        GD.Print($"town in: {JsonSerializer.Serialize(world.Report)}");

        if (DedicatedServer) { Loaded = true; return; }

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
        foreach (var part in parts.Where(p => p.GetParent() == null))
        {
            // a part built beside the town's load is laid in at its own place, once its worker is done
            if (part is World.Ruien.Ruien early && !early.Beside.IsCompleted)
                using (Dev.StartupTiming.Measure("part.Ruien.wait"))
                    while (!early.Beside.IsCompleted) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            var partClock = System.Diagnostics.Stopwatch.StartNew();
            using(Dev.StartupTiming.Measure("part."+part.GetType().Name)) AddChild(part);
            if (partClock.ElapsedMilliseconds >= 100) GD.Print($"startup part: {part.GetType().Name}: {partClock.ElapsedMilliseconds} ms");
            // one frame once the walk map is made: the game rules start their own set-up then (NativeTownGame)
            if (part is World.Lights) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
        }
        using(Dev.StartupTiming.Measure("prepare-mover-code"))
            if (!Flag("movers-original")) Movers.MoverCost.PrepareCode(parts);
        Loaded = true;
        Dev.StartupTiming.Mark("main.loaded");
        Scheldemist.World.StartupResources.Release();
        // (cache entries no start has used for days go, beside the game: World/StartupCachePrune)
        if (!Flag("no-startup-cache")) Scheldemist.World.StartupCachePrune.Start();
    }

    /// <summary>
    /// The town's street cuts are made (any thread): the parts that build beside the town's load start now, on the main
    /// thread's next frame (dev: --ruien-in-order builds the Ruien at its own place in the start, as before).
    /// </summary>
    public void StreetCutsDone()
    {
        if (parts == null || Flag("ruien-in-order")) return;
        Callable.From(() => { foreach (var ruien in parts.OfType<World.Ruien.Ruien>()) ruien.StartBeside(); }).CallDeferred();
    }

    /// <summary>
    /// The picture's settings (src/Menu/Apply.cs): the lines the world is drawn at (0: as many as the window has),
    /// times the render scale.
    /// </summary>
    public void SetPicture(int lines, float scale)
    {
        this.lines = lines;
        renderScale = scale;
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
        // (no vertex snap: a grid too fine to see)
        SnapGrid = new Vector2(1e5f, 1e5f);
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
        Render.UniformUpdates.Global("psx_time", SnapTime ?? Time.GetTicksMsec() / 1000f);
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

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
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
    private const int Lines = 720;
    private const int FxLines = 270;

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
    public string Arg(string k, string d = "")
    {
        var args = OS.GetCmdlineUserArgs();
        int i = Array.IndexOf(args, "--" + k);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : d;
    }
    public bool Flag(string k) => Array.IndexOf(OS.GetCmdlineUserArgs(), "--" + k) >= 0;

    private SubViewport view = null!;
    private TextureRect screen = null!;
    private ShaderMaterial retro = null!;
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
        string bake = OS.GetEnvironment("SCHELDEMIST_BAKE");
        string town = Arg("town", bake != "" ? bake : ProjectSettings.GlobalizePath("res://baked/town.glb"));
        shots = Arg("shots", "");

        view = new SubViewport { RenderTargetUpdateMode = SubViewport.UpdateMode.Always, Msaa3D = Viewport.Msaa.Disabled, HandleInputLocally = false };
        AddChild(view);
        retro = new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/retro.gdshader") };
        screen = new TextureRect { Texture = view.GetTexture(), ExpandMode = TextureRect.ExpandModeEnum.IgnoreSize, StretchMode = TextureRect.StretchModeEnum.Scale, TextureFilter = CanvasItem.TextureFilterEnum.Nearest, Material = retro, MouseFilter = Control.MouseFilterEnum.Ignore };
        screen.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        AddChild(screen);
        GetViewport().SizeChanged += Resize;

        world = new BakedWorld();
        view.AddChild(world);
        var err = world.Load(town);
        if (err != Error.Ok)
        {
            GD.PrintErr($"the baked town did not load ({err}): {town}. Bake it: node tools/godot/export-scene.mjs");
            GetTree().Quit(1);
            return;
        }
        GD.Print($"town in: {JsonSerializer.Serialize(world.Report)}");

        var facts = world.Facts.RootElement.GetProperty("facts");
        Daylight(facts);
        var c0 = facts.GetProperty("camera");
        cam = new FlyCam { Fov = c0.GetProperty("fov").GetSingle(), Near = Math.Max(0.05f, c0.GetProperty("near").GetSingle()), Far = c0.GetProperty("far").GetSingle(), Current = true };
        view.AddChild(cam);
        Cam = cam;
        Ui = new CanvasLayer { Layer = 10 };
        AddChild(Ui);
        places = world.Facts.RootElement.GetProperty("places");
        Go(0);
        Resize();
        if (shots != "")
        {
            DisplayServer.WindowSetVsyncMode(DisplayServer.VSyncMode.Disabled);
            Engine.MaxFps = 0;
        }
        foreach (var part in GamePartAttribute.Make(this)) AddChild(part);
    }

    /// <summary>The fog, the sky's light and the sun as the bake found them (13:00, clear). The clock and the weather come with world/ambient.</summary>
    private void Daylight(JsonElement facts)
    {
        var fog = Hex(0x8f989c);
        float near = 20, far = 160;
        if (facts.GetProperty("fog").ValueKind == JsonValueKind.Object)
        {
            var f = facts.GetProperty("fog");
            fog = Hex(f.GetProperty("color").GetInt32());
            if (f.TryGetProperty("near", out var a) && a.ValueKind == JsonValueKind.Number) near = a.GetSingle();
            if (f.TryGetProperty("far", out var b) && b.ValueKind == JsonValueKind.Number) far = b.GetSingle();
        }
        RenderingServer.GlobalShaderParameterSet("psx_fog_color", fog);
        RenderingServer.GlobalShaderParameterSet("psx_fog_near", near);
        RenderingServer.GlobalShaderParameterSet("psx_fog_far", far);
        var env = new Godot.Environment
        {
            BackgroundMode = Godot.Environment.BGMode.Color,
            BackgroundColor = fog,
            AmbientLightSource = Godot.Environment.AmbientSource.Disabled,
            TonemapMode = Godot.Environment.ToneMapper.Linear,
        };
        view.AddChild(new WorldEnvironment { Environment = env });

        // three's lights give colour x intensity / pi on a matt face; Godot's give colour x energy
        Color sky = Hex(0x8494a6) * 1.1f / MathF.PI, ground = Hex(0x2a2822) * 1.1f / MathF.PI;
        foreach (var l in facts.GetProperty("lights").EnumerateArray())
        {
            string type = l.GetProperty("type").GetString() ?? "";
            float k = l.GetProperty("intensity").GetSingle() / MathF.PI;
            var col = Hex(l.GetProperty("color").GetInt32());
            if (type == "HemisphereLight")
            {
                sky = col * k;
                if (l.TryGetProperty("ground", out var g) && g.ValueKind == JsonValueKind.Number) ground = Hex(g.GetInt32()) * k;
            }
            else if (type == "DirectionalLight")
            {
                var p = l.GetProperty("pos");
                var sun = new DirectionalLight3D { LightColor = col, LightEnergy = k, ShadowEnabled = false };
                view.AddChild(sun);
                sun.LookAtFromPosition(new Vector3(p[0].GetSingle(), p[1].GetSingle(), p[2].GetSingle()), Vector3.Zero, Vector3.Up);
            }
        }
        RenderingServer.GlobalShaderParameterSet("psx_hemi_sky", sky);
        RenderingServer.GlobalShaderParameterSet("psx_hemi_ground", ground);
    }

    private static Color Hex(int h) => new Color(((h >> 16) & 255) / 255f, ((h >> 8) & 255) / 255f, (h & 255) / 255f).SrgbToLinear();

    private void Resize()
    {
        var win = GetViewport().GetVisibleRect().Size;
        if (win.Y < 1) return;
        float aspect = win.X / win.Y;
        int h = (int)Math.Min(Lines, win.Y);
        var size = new Vector2I(Math.Max(1, (int)MathF.Round(h * aspect)), h);
        view.Size = size;
        retro.SetShaderParameter("res", new Vector2(size.X, size.Y));
        retro.SetShaderParameter("fx_res", new Vector2(MathF.Round(FxLines * aspect), FxLines));
        // the snap grid of the 270-line picture, halved (main.ts)
        RenderingServer.GlobalShaderParameterSet("psx_snap_res", new Vector2(MathF.Round(FxLines * aspect) * 0.5f, FxLines * 0.5f));
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
        RenderingServer.GlobalShaderParameterSet("psx_time", Time.GetTicksMsec() / 1000f);
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

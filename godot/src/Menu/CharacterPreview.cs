using System;
using Godot;
using Scheldemist.People;
using Scheldemist.Player;

namespace Scheldemist.Menu;

/// <summary>A private 3D world for the tailor's turning figure. Drags turn it; sliders rebuild only after edits.</summary>
public partial class CharacterPreview : SubViewportContainer
{
    private Human? human;
    private SubViewport view = null!;
    private Profile? pending;
    private float wait, turn = .18f;
    private bool dragging;
    internal static Action<Profile> Make(Control frame)
    {
        var preview = new CharacterPreview { Stretch = true, MouseFilter = MouseFilterEnum.Stop, TooltipText = "Drag to turn your character" };
        frame.AddChild(preview); preview.SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        return preview.ShowProfile;
    }
    public override void _Ready()
    {
        view = new SubViewport { Name = "character_world", OwnWorld3D = true, Size = new Vector2I(400, 560), TransparentBg = false, RenderTargetUpdateMode = SubViewport.UpdateMode.Always, Msaa3D = Viewport.Msaa.Msaa2X };
        AddChild(view);
        var env = new Godot.Environment { BackgroundMode = Godot.Environment.BGMode.Color, BackgroundColor = new Color("292b29"), AmbientLightSource = Godot.Environment.AmbientSource.Color, AmbientLightColor = new Color("ccd1c9"), AmbientLightEnergy = .65f };
        view.AddChild(new WorldEnvironment { Environment = env });
        var cam = new Camera3D { Position = new Vector3(0, 1.03f, 3.05f), Fov = 37, Current = true, Near = .05f };
        view.AddChild(cam); cam.LookAt(new Vector3(0, .87f, 0));
        view.AddChild(new DirectionalLight3D { RotationDegrees = new Vector3(-35, -35, 0), LightEnergy = 1.4f, ShadowEnabled = false });
        view.AddChild(new DirectionalLight3D { RotationDegrees = new Vector3(-25, 140, 0), LightEnergy = .6f, ShadowEnabled = false });
    }
    internal void ShowProfile(Profile p) => pending = p.Clone();
    public override void _Process(double delta)
    {
        float dt = (float)Math.Min(delta, .05);
        wait -= dt;
        if (pending != null && wait <= 0)
        {
            human?.Dispose(); human = Arms.Make(pending); pending = null;
            view.AddChild(human.Root); wait = .08f;
        }
        if (human != null)
        {
            human.Root.Rotation = new Vector3(0, turn, 0);
            human.Play("idle"); human.Update(dt);
        }
    }
    public override void _GuiInput(InputEvent e)
    {
        if (e is InputEventMouseButton { ButtonIndex: MouseButton.Left } b) dragging = b.Pressed;
        else if (dragging && e is InputEventMouseMotion m) { turn += m.Relative.X * .012f; AcceptEvent(); }
    }
    public override void _ExitTree() => human?.Dispose();
}

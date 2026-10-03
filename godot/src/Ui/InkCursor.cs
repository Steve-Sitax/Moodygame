using System;
using Godot;

namespace Scheldemist.Ui;

/// <summary>
/// The mouse in the game's dialogs (the browser's game/cursor.ts): while a dialog is up (Dialogs.Register) and Jef is
/// in play, the mouse moves a quill drawn on the picture instead of turning the view. It cannot leave the window,
/// and a click does what a click on that line or button does. Over something to click the nib dips a little.
/// When the dialog closes the mouse turns the view again.
///
/// The menu's part makes one (`new InkCursor()` under Main.I.Ui) and tells it when Jef plays (`Playing`).
/// </summary>
public partial class InkCursor : Control
{
    public static InkCursor? I { get; private set; }

    /// <summary>Is Jef in play (the game has the mouse, no menu, no pause)? Set by the menu's part.</summary>
    public Func<bool> Playing { get; set; } = () => false;
    /// <summary>Is the quill on screen now.</summary>
    public bool Shown { get; private set; }
    /// <summary>Where its nib is, window px.</summary>
    public Vector2 At { get; private set; }
    /// <summary>It is over something to click.</summary>
    public bool Hot { get; private set; }

    // cursor.ts QUILL: a goose quill, the nib top left
    private const string Quill = @"<svg xmlns=""http://www.w3.org/2000/svg"" width=""36"" height=""36"" viewBox=""0 0 30 30"">
  <path d=""M1.5 1.5 C6 3 10 5.5 14 9 C19 13.5 24 20 28.5 28.5 C21 25 13.5 19.5 8.5 14 C5 10.2 2.8 6 1.5 1.5 Z"" fill=""#efe6cf"" stroke=""#2a241c"" stroke-width=""1.5"" stroke-linejoin=""round""/>
  <path d=""M1.5 1.5 L21 21"" stroke=""#2a241c"" stroke-width=""1.1"" stroke-linecap=""round""/>
  <path d=""M9 7.5 L6.8 11 M13.2 11.2 L10.8 15 M17.2 15.2 L14.8 19 M21 19.6 L18.8 23"" stroke=""#2a241c"" stroke-width=""0.8"" opacity=""0.55""/>
  <path d=""M1.5 1.5 L5.2 2.9 L2.9 5.2 Z"" fill=""#2a241c""/>
</svg>";

    private readonly TextureRect quill;
    private readonly TextureRect shade;

    public InkCursor()
    {
        I = this;
        Name = "InkCursor";
        ProcessMode = ProcessModeEnum.Always;
        MouseFilter = MouseFilterEnum.Ignore;
        SetAnchorsPreset(LayoutPreset.FullRect);
        ZIndex = 100;
        var img = new Image();
        img.LoadSvgFromString(Quill, 2);
        var tex = ImageTexture.CreateFromImage(img);
        // the drop shadow: the same quill in black, a little down and right
        shade = new TextureRect { Texture = tex, ExpandMode = TextureRect.ExpandModeEnum.IgnoreSize, Size = new Vector2(36, 36), MouseFilter = MouseFilterEnum.Ignore, Modulate = new Color(0, 0, 0, 0.35f), Visible = false, PivotOffset = new Vector2(2, 2) };
        quill = new TextureRect { Texture = tex, ExpandMode = TextureRect.ExpandModeEnum.IgnoreSize, Size = new Vector2(36, 36), MouseFilter = MouseFilterEnum.Ignore, Visible = false, PivotOffset = new Vector2(2, 2) };
        AddChild(shade);
        AddChild(quill);
    }

    public override void _ExitTree()
    {
        if (I == this) I = null;
    }

    public override void _Process(double delta)
    {
        bool on = Dialogs.Cursor() && Playing();
        if (on != Shown)
        {
            Shown = on;
            quill.Visible = shade.Visible = on;
            if (on)
            {
                // it comes up in the middle of the window, on the dialog
                Input.MouseMode = Input.MouseModeEnum.ConfinedHidden;
                GetViewport().WarpMouse(GetViewport().GetVisibleRect().Size / 2);
            }
            else if (Playing()) Input.MouseMode = Input.MouseModeEnum.Captured;
            else if (Input.MouseMode == Input.MouseModeEnum.ConfinedHidden) Input.MouseMode = Input.MouseModeEnum.Visible;
        }
        if (!on) return;
        if (Input.MouseMode != Input.MouseModeEnum.ConfinedHidden) Input.MouseMode = Input.MouseModeEnum.ConfinedHidden;
        At = GetViewport().GetMousePosition();
        var over = GetViewport().GuiGetHoveredControl();
        Hot = over is BaseButton or LineEdit || (over != null && over.MouseDefaultCursorShape == CursorShape.PointingHand);
        float s = Kit.Scale / 1.5f;
        foreach (var t in new[] { shade, quill })
        {
            t.Scale = Vector2.One * s * (Hot ? 1.06f : 1f);
            t.RotationDegrees = Hot ? -8 : 0;
        }
        quill.Position = At - new Vector2(2, 2);
        shade.Position = At - new Vector2(2, 2) + new Vector2(1, 2) * s;
    }
}

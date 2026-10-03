using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.Ui.Dialogs;

/// <summary>
/// A panel with its own keys (a talk, a list with number keys, a page to read, the dice): what the stack needs to
/// know of it (game/dialogs.ts Entry). The keys come as the browser names them: the code ("KeyE", "Digit2",
/// "Escape", "Enter") and the key ("e", "2").
/// </summary>
public interface IDialog
{
    /// <summary>The dialog's name for the checks ("talk", "pockets", "press page").</summary>
    string DialogName { get; }
    /// <summary>The mouse works it (lines and keys to click); false: the mouse keeps the look (a menace to walk away from).</summary>
    bool Cursor => true;
    /// <summary>Esc closes it or steps back in it; false: Esc is the menu's (a gang's demand, asleep).</summary>
    bool EscCloses => true;
    /// <summary>A text field of it has the keyboard: letters go there, only Enter and Esc come as keys.</summary>
    bool Typing => false;
    /// <summary>A key for this dialog (it is on top). Never a repeat.</summary>
    void OnKey(string code, string key);
}

/// <summary>
/// The dialogs on screen (game/dialogs.ts, game/cursor.ts): a stack. The keyboard belongs to the dialog on top and
/// to nothing under it (not to the other dialogs, not to the game); each dialog closes itself on its own keys
/// (E and Esc for most), and Esc with a dialog up never opens the menu (Escapable). While a dialog that the mouse
/// works is up the mouse is free, as the quill, and the lines with a number and the keys named in a keys line can
/// be clicked; it is taken again as it was when the last dialog closes.
///
///   Dialogs.I.Open(this) / Dialogs.I.Close(this)   a dialog comes up, goes
///   Dialogs.I.Any                                  the player's part stands still while this is true
///   Dialogs.I.Layer                                where a dialog puts its paper
///   Dialogs.I.KeyLabel / Remap                     the menus' part: the bound key's name, the key's action
/// </summary>
[GamePart(950)]
public partial class Dialogs : Node
{
    public static Dialogs? I { get; private set; }

    private readonly List<IDialog> stack = new();
    private Control layer = null!;
    private Control shield = null!;
    private Input.MouseModeEnum mouseWas = Input.MouseModeEnum.Visible;
    private bool mouseFreed;
    private float ui;

    /// <summary>A dialog came up or went (Any may have changed).</summary>
    public event Action? Changed;
    /// <summary>The window's size changed, or its --ui scale: the papers are built again.</summary>
    public event Action? Resized;
    /// <summary>The name to show for a key the game listens for (menu/keys.ts keyLabel); not set: the letter on the player's own keyboard.</summary>
    public Func<string, string>? KeyLabel { get; set; }
    /// <summary>The key pressed to the code of the action it is bound to (menu/keys.ts remap); not set: the key itself.</summary>
    public Func<string, string>? Remap { get; set; }
    /// <summary>The test's switch: leave the mouse alone (the pictures are taken by script, Steve's mouse is his).</summary>
    public bool KeepMouse { get; set; }

    public Dialogs()
    {
        I = this;
    }

    public override void _Ready()
    {
        layer = new Control { Name = "Dialogs", MouseFilter = Control.MouseFilterEnum.Ignore };
        layer.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        Main.I.Ui.AddChild(layer);
        // under the papers, over the game: a click beside a dialog is not a click in the world
        shield = new Control { Name = "Shield", MouseFilter = Control.MouseFilterEnum.Stop, Visible = false };
        shield.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        layer.AddChild(shield);
        ui = Css.Ui(GetViewport().GetVisibleRect().Size.X);
        GetViewport().SizeChanged += OnResize;
    }

    public override void _ExitTree()
    {
        FreeMouse(false);
        if (I == this) I = null;
    }

    private void OnResize()
    {
        ui = Css.Ui(GetViewport().GetVisibleRect().Size.X);
        Resized?.Invoke();
    }

    // ------------------------------------------------------------------ what is up

    /// <summary>Where the dialogs' papers go: over the HUD.</summary>
    public Control Layer => layer;
    /// <summary>The --ui scale of the window now.</summary>
    public float Ui => ui;
    /// <summary>Is any dialog up now? The player stands still, the game's own keys rest.</summary>
    public bool Any => stack.Count > 0;
    /// <summary>The dialog the keys go to.</summary>
    public IDialog? Top => stack.Count > 0 ? stack[^1] : null;
    /// <summary>Is a dialog up that Esc closes (Esc is then not the menu's)?</summary>
    public bool Escapable => stack.Any(d => d.EscCloses);
    /// <summary>Is a dialog up that the mouse works?</summary>
    public bool Cursor => stack.Any(d => d.Cursor);
    /// <summary>The names of the dialogs up now, the lowest first (the checks).</summary>
    public IReadOnlyList<string> Up => stack.Select(d => d.DialogName).ToList();
    public bool IsUp(IDialog d) => stack.Contains(d);

    /// <summary>A dialog comes up, on top (one that is up already goes to the top).</summary>
    public void Open(IDialog d)
    {
        stack.Remove(d);
        stack.Add(d);
        Sync();
    }

    public void Close(IDialog d)
    {
        if (!stack.Remove(d)) return;
        Sync();
    }

    private void Sync()
    {
        shield.Visible = Any;
        FreeMouse(Cursor);
        Changed?.Invoke();
    }

    // ------------------------------------------------------------------ the mouse

    /// <summary>The mouse let go for the dialogs, as the quill, and taken back as it was after.</summary>
    private void FreeMouse(bool free)
    {
        if (free == mouseFreed || KeepMouse) return;
        mouseFreed = free;
        if (free)
        {
            mouseWas = Input.MouseMode;
            Input.MouseMode = Input.MouseModeEnum.Visible;
            if (Quill is { } q)
            {
                Input.SetCustomMouseCursor(q, Input.CursorShape.Arrow, new Vector2(2, 2));
                Input.SetCustomMouseCursor(q, Input.CursorShape.PointingHand, new Vector2(2, 2));
            }
            // it comes up in the middle of the window, on the dialog
            if (mouseWas == Input.MouseModeEnum.Captured) GetViewport().WarpMouse(GetViewport().GetVisibleRect().Size / 2);
        }
        else
        {
            Input.SetCustomMouseCursor(null, Input.CursorShape.Arrow);
            Input.SetCustomMouseCursor(null, Input.CursorShape.PointingHand);
            Input.MouseMode = mouseWas;
        }
    }

    // game/cursor.ts QUILL: the ink cursor, its nib at the top left
    private const string QuillSvg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"36\" height=\"36\" viewBox=\"0 0 30 30\">" +
        "<path d=\"M1.5 1.5 C6 3 10 5.5 14 9 C19 13.5 24 20 28.5 28.5 C21 25 13.5 19.5 8.5 14 C5 10.2 2.8 6 1.5 1.5 Z\" fill=\"#efe6cf\" stroke=\"#2a241c\" stroke-width=\"1.5\" stroke-linejoin=\"round\"/>" +
        "<path d=\"M1.5 1.5 L21 21\" stroke=\"#2a241c\" stroke-width=\"1.1\" stroke-linecap=\"round\"/>" +
        "<path d=\"M9 7.5 L6.8 11 M13.2 11.2 L10.8 15 M17.2 15.2 L14.8 19 M21 19.6 L18.8 23\" stroke=\"#2a241c\" stroke-width=\"0.8\" opacity=\"0.55\"/>" +
        "<path d=\"M1.5 1.5 L5.2 2.9 L2.9 5.2 Z\" fill=\"#2a241c\"/></svg>";
    private static ImageTexture? quill;
    private static bool quillTried;

    private static ImageTexture? Quill
    {
        get
        {
            if (quillTried) return quill;
            quillTried = true;
            var img = new Image();
            if (img.LoadSvgFromString(QuillSvg) == Error.Ok) quill = ImageTexture.CreateFromImage(img);
            return quill;
        }
    }

    // ------------------------------------------------------------------ the keys

    /// <summary>
    /// Every key while a dialog is up: to the dialog on top, and no further. A text field of the dialog keeps the
    /// letters; Enter and Esc still come as keys.
    /// </summary>
    public override void _Input(InputEvent e)
    {
        if (stack.Count == 0 || e is not InputEventKey k) return;
        var top = stack[^1];
        string code = CodeOf(k);
        bool typing = top.Typing;
        if (typing && code != "Enter" && code != "Escape") return; // the text field's
        GetViewport().SetInputAsHandled();
        if (!k.Pressed || k.Echo || code == "") return;
        if (!typing) code = Remap?.Invoke(code) ?? code;
        top.OnKey(code, KeyOf(code));
    }

    /// <summary>The code of the action a key pressed stands for (for a part's own key with no dialog up: I, J).</summary>
    public string GameCode(InputEventKey k)
    {
        string code = CodeOf(k);
        return Remap?.Invoke(code) ?? code;
    }

    /// <summary>Send the dialog on top a key, as the keyboard does (a click on a line, a test).</summary>
    public void SendKey(string code)
    {
        if (stack.Count > 0) stack[^1].OnKey(code, KeyOf(code));
    }

    /// <summary>The browser's name for the key pressed, by its place on the keyboard (KeyboardEvent.code).</summary>
    public static string CodeOf(InputEventKey k)
    {
        Key p = k.PhysicalKeycode != Key.None ? k.PhysicalKeycode : k.Keycode;
        if (p >= Key.A && p <= Key.Z) return "Key" + (char)('A' + (p - Key.A));
        if (p >= Key.Key0 && p <= Key.Key9) return "Digit" + (char)('0' + (p - Key.Key0));
        if (p >= Key.Kp0 && p <= Key.Kp9) return "Numpad" + (char)('0' + (p - Key.Kp0));
        return p switch
        {
            Key.Escape => "Escape",
            Key.Enter or Key.KpEnter => "Enter",
            Key.Space => "Space",
            Key.Tab => "Tab",
            Key.Backspace => "Backspace",
            _ => "",
        };
    }

    /// <summary>game/cursor.ts keyOf: "Digit2" is "2", "KeyE" is "e".</summary>
    public static string KeyOf(string code) =>
        code.StartsWith("Digit", StringComparison.Ordinal) ? code[5..] :
        code.StartsWith("Numpad", StringComparison.Ordinal) ? code[6..] :
        code.StartsWith("Key", StringComparison.Ordinal) ? code[3..].ToLowerInvariant() : code;

    /// <summary>The digit a key stands for (1 to 9), or 0: the number row and the number pad.</summary>
    public static int Digit(string key) => key.Length == 1 && key[0] >= '1' && key[0] <= '9' ? key[0] - '0' : 0;

    /// <summary>
    /// The name on the paper for a key the game listens for: the menus' bound key when that part is in, else the
    /// letter on that key of the player's own keyboard (KeyW is "Z" on a Belgian one), as the browser shows it.
    /// </summary>
    public static string Label(string code)
    {
        if (I?.KeyLabel is { } f) return f(code);
        if (code.Length == 4 && code.StartsWith("Key", StringComparison.Ordinal))
        {
            Key label = DisplayServer.KeyboardGetLabelFromPhysical(Key.A + (code[3] - 'A'));
            if (label >= Key.A && label <= Key.Z) return ((char)('A' + (label - Key.A))).ToString();
            return code[3..];
        }
        return code == "Escape" ? "Esc" : KeyOf(code);
    }
}

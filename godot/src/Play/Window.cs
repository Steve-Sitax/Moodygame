using System;
using Godot;
using Scheldemist.Windows;

namespace Scheldemist.Play;

/// <summary>
/// One of the hands' own papers on the dialogs' stack (Windows/Dialogs.cs): the hiring board, the quest book, the
/// sleep chooser, the sheet after a night, the trouble on a job. It keeps the sheet it is written on, puts it on the
/// dialogs' layer, and hands its keys to the part that owns it.
/// </summary>
public sealed class Window : IDialog
{
    public string DialogName { get; }
    public bool Cursor { get; init; } = true;
    public bool EscCloses { get; init; } = true;
    private readonly Action<string, string> onKey;
    private readonly Func<Sheet?> write;
    private Sheet? sheet;

    /// <param name="write">Writes the paper as it is now (called when it opens, when it changes, when the window's size changes); null: nothing to show.</param>
    public Window(string name, Func<Sheet?> write, Action<string, string> onKey)
    {
        DialogName = name;
        this.write = write;
        this.onKey = onKey;
    }

    public bool IsOpen { get; private set; }
    public Sheet? Sheet => sheet;

    public void Open()
    {
        if (Dialogs.I is not { } d) return;
        if (!IsOpen)
        {
            IsOpen = true;
            d.Resized += Render;
        }
        d.Open(this);
        Render();
    }

    public void Close()
    {
        if (!IsOpen) return;
        IsOpen = false;
        if (Dialogs.I is { } d)
        {
            d.Resized -= Render;
            d.Close(this);
        }
        Drop();
    }

    private void Drop()
    {
        if (sheet != null && GodotObject.IsInstanceValid(sheet.Card)) sheet.Card.QueueFree();
        sheet = null;
    }

    /// <summary>Write the paper again (its words changed). A paper that was scrolled stays where it was read.</summary>
    public void Render()
    {
        if (!IsOpen || Dialogs.I is not { } d) return;
        int read = sheet?.Scroll is { } was && GodotObject.IsInstanceValid(was) ? was.ScrollVertical : 0;
        Drop();
        sheet = write();
        if (sheet == null) return;
        d.Layer.AddChild(sheet.Card);
        sheet.Place();
        if (read > 0 && sheet.Scroll is { } scroll)
        {
            // the bar knows its length once the new text is laid out
            var bar = scroll.GetVScrollBar();
            void Back()
            {
                if (!GodotObject.IsInstanceValid(scroll)) return;
                scroll.ScrollVertical = read;
                if (scroll.ScrollVertical == read) bar.Changed -= Back;
            }
            bar.Changed += Back;
            Back();
        }
    }

    public void OnKey(string code, string key) => onKey(code, key);

    /// <summary>The usual place: the middle of the window.</summary>
    public static Vector2 Middle(Vector2 win, Vector2 size) => (win - size) / 2;
}

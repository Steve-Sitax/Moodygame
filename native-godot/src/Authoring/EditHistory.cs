using System.Collections.Generic;

namespace Scheldemist.Native.Authoring;

/// <summary>Each complete user action has one reversible before/after pair.</summary>
public sealed class EditHistory
{
    private readonly List<(LayoutDocument Before, LayoutDocument After)> edits = new();
    private int cursor;
    public bool CanUndo => cursor > 0;
    public bool CanRedo => cursor < edits.Count;
    public void Add(LayoutDocument before, LayoutDocument after)
    {
        if (cursor < edits.Count) edits.RemoveRange(cursor, edits.Count - cursor);
        edits.Add((before.Copy(), after.Copy())); cursor++;
        if (edits.Count > 100) { edits.RemoveAt(0); cursor--; }
    }
    public LayoutDocument? Undo() => CanUndo ? edits[--cursor].Before.Copy() : null;
    public LayoutDocument? Redo() => CanRedo ? edits[cursor++].After.Copy() : null;
}

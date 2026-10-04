using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Play;

namespace Scheldemist.Dev;

/// <summary>Snapshot borrowed offers before a second query mutates them; callbacks are exercised by gameplay checks.</summary>
public static class OfferComparison
{
    private readonly record struct State(int Kind, float Distance, Key Key, string Text, float X, float? Y, float Z, bool Self, float? Cone);
    private static State[] Capture(Offers? offers)
    {
        var states = new List<State>();
        void Add(int kind, float distance, Act a) => states.Add(new(kind, distance, a.Key, a.Text, a.X, a.Y, a.Z, a.Self, a.Cone));
        if (offers?.Only != null) { states.Add(new(-1, 0, 0, "", 0, null, 0, false, null)); foreach (var a in offers.Only) Add(0, 0, a); }
        if (offers?.First != null) { states.Add(new(-2, 0, 0, "", 0, null, 0, false, null)); foreach (var a in offers.First) Add(1, 0, a); }
        if (offers?.Options != null) { states.Add(new(-3, 0, 0, "", 0, null, 0, false, null)); foreach (var (d, a) in offers.Options) Add(2, d, a); }
        if (offers?.Extra != null) { states.Add(new(-4, 0, 0, "", 0, null, 0, false, null)); foreach (var a in offers.Extra) Add(3, 0, a); }
        return states.ToArray();
    }
    public static bool Same(Func<Offers?> original, Func<Offers?> current)
    {
        var before = Capture(original());
        return before.SequenceEqual(Capture(current()));
    }
}

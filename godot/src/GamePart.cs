using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Godot;

namespace Scheldemist;

/// <summary>
/// A part of the game (the player, the sky, the server link, the people ...): a Node class with this attribute is
/// made once and added under Main when the town is in, lowest Order first. So a new part is one new file and no
/// edit to Main. A part finds the rest through Main.I (View, World, Cam, Ui, Arg). Off with --no-<name> on the
/// command line (the class name in lower case), or all but some with --only a,b.
/// </summary>
[AttributeUsage(AttributeTargets.Class)]
public sealed class GamePartAttribute : Attribute
{
    public int Order { get; }
    public GamePartAttribute(int order = 100) => Order = order;

    public static IEnumerable<Node> Make(Main main)
    {
        string only = main.Arg("only");
        var keep = only == "" ? null : only.Split(',');
        return Assembly.GetExecutingAssembly().GetTypes()
            .Select(t => (t, a: t.GetCustomAttribute<GamePartAttribute>()))
            .Where(x => x.a != null && typeof(Node).IsAssignableFrom(x.t))
            .Where(x => !main.Flag("no-" + x.t.Name.ToLowerInvariant()) && (keep == null || keep.Contains(x.t.Name.ToLowerInvariant())))
            .OrderBy(x => x.a!.Order).ThenBy(x => x.t.Name)
            .Select(x => { var n = (Node)Activator.CreateInstance(x.t)!; n.Name = x.t.Name; return n; })
            .ToList();
    }
}

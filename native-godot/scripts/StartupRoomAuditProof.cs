using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Godot;
using Scheldemist.World;

/// <summary>Opt-in full-world comparison against the original room audit lookup, after the startup timer ends.</summary>
public static class StartupRoomAuditProof
{
    public static void Verify()
    {
        var rooms=(IEnumerable)typeof(Rooms).GetField("rooms",BindingFlags.NonPublic|BindingFlags.Instance)!.GetValue(Rooms.I)!;
        var markers=BakedWorld.All(Scheldemist.Main.I.World).OfType<Node3D>().Where(n=>n.Name.ToString().StartsWith("opening_")&&n.HasMeta("extras")&&n.GetMeta("extras").AsGodotDictionary().ContainsKey("kind")).ToArray();
        int count=0;
        foreach(var room in rooms)
        {
            var type=room.GetType();string id=(string)type.GetField("Id")!.GetValue(room)!;
            var apertures=(List<(string kind,Aabb box,bool open)>)type.GetField("AuditOpenings")!.GetValue(room)!;
            var expected=markers.Where(n=>apertures.Any(o=>o.kind==(n.GetMeta("extras").AsGodotDictionary()["kind"].AsString()=="door"?"door":"window")&&o.box.Grow(.15f).HasPoint(n.GlobalPosition))).ToArray();
            var shut=expected.Where(n=>apertures.Any(o=>o.kind=="door"&&!o.open&&o.box.Grow(.15f).HasPoint(n.GlobalPosition))).ToArray();
            var actual=Rooms.I.InteriorAuditTargets.Single(t=>t.Id==id);
            if(!expected.SequenceEqual(actual.Openings)||!shut.SequenceEqual(actual.ShutDoors))throw new Exception("Room audit marker or closed-door mismatch: "+id);
            count++;
        }
        GD.Print($"STARTUP_ROOMS_PASS: {count} rooms, exact opening and closed-door references and ordering");
    }
}

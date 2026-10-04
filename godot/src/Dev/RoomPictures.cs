using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Dev;

/// <summary>Repeatable close views through real windows, from both sides of the opening.</summary>
public static class RoomPictures
{
    public static async Task<object> Run(Checks check)
    {
        var rows = new List<object>(); bool fly = Jef.I.Fly;
        if (!fly) Jef.I.ToggleFly();
        var cam = Main.I.Cam; var saved = cam.GlobalTransform;
        try
        {
            foreach (double hour in new[] { 13.0, 22.0 })
            {
                await Kit.I.Light(hour, "clear");
                foreach (string id in new[] { "cathedral", "carolus", "shop:bakery_steen", "shop:chandler_werf", "tavern:ankere" })
                {
                    var target = Rooms.I.InteriorAuditTargets.First(t => t.Id == id);
                    var marker = target.Openings.First(n => n.GetMeta("extras").AsGodotDictionary()["kind"].AsString() == "window" && (id != "cathedral" || n.GlobalPosition.Y < 12));
                    var e = marker.GetMeta("extras").AsGodotDictionary();
                    float Num(string k) => e.TryGetValue(k, out var v) ? v.AsSingle() : 0;
                    var normal = ((marker.GetParent() as Node3D)?.GlobalBasis ?? Basis.Identity) * new Vector3(Num("nx"), Num("ny"), Num("nz"));
                    normal = normal.Normalized(); var p = marker.GlobalPosition;
                    float outside = id == "cathedral" ? 8 : id == "carolus" ? 2.2f : 1.8f;
                    Rooms.I.AuditRoom = id;
                    foreach (bool inside in new[] { false, true })
                    {
                        var at = p + normal * (inside ? -(Num("depth") + 1.2f) : outside);
                        cam.LookAtFromPosition(at, p, Vector3.Up);
                        if (cam is FlyCam f) f.Face(cam.Quaternion);
                        await check.Frames(120);
                        string name = id.Replace(':', '_') + (hour == 13 ? "_day" : "_night") + (inside ? "_inside" : "_street");
                        rows.Add(new { room = id, hour, inside, opening = e["label"].AsString(), at = new[] { at.X, at.Y, at.Z }, picture = check.Picture(name) });
                    }
                }
            }
        }
        finally { Rooms.I.AuditRoom = null; cam.GlobalTransform = saved; if (!fly) Jef.I.ToggleFly(); }
        return new { ok = true, pictures = rows };
    }
}

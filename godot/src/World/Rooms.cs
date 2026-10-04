using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using Godot;
using Scheldemist.Render;

namespace Scheldemist.World;

/// <summary>
/// The rooms behind the openings (the browser's world/inworld.ts, rooms.ts, houseInWorld.ts). In the browser a room
/// is a scene of its own, drawn over the street through its openings with a punch in the wall. Here the bake puts
/// every room in the world as a group ROOM_&lt;id&gt; inside its shell (tools/godot/export-scene.mjs), so an opening
/// simply shows what stands behind it: the shop behind its window, the street from inside. This part gives a room
/// what its own scene gave it:
/// - its own light: the room's sky and ambient light on its meshes (the psx material's Indoor switch) and its lamps
///   as real lights that light the room only (layer RoomLayer); by day as the bake found them, after dark as lit
///   (the bake's lights at 18:20), out when a shop or a tavern is shut;
/// - the dark lining of the house (the street's stand-in for a room not drawn) hidden while the room is shown: a
///   room is shown within its reach (90 m for a house), the lining beyond;
/// - the glass: a little of the sky on it by day, nearly clear at night;
/// - the door's leaf and transom once (the room's scene carried a copy of the street's).
/// Open or shut: the shops' part sets it (SetOpen); until then by the clock (a shop 7 to 19, a tavern 10 to 24).
/// Not yet: the room's own air when the eye is inside (the street's fog is used), people inside lit by the room.
/// </summary>
[GamePart(50)]
public partial class Rooms : Node
{
    public static Rooms I { get; private set; } = null!;
    /// <summary>The rooms' meshes: their lamps light only these.</summary>
    public const uint RoomLayer = 1u << 12;

    private sealed class Lamp
    {
        public OmniLight3D Light = null!;
        public float Day, Lit;
    }

    private sealed class Room
    {
        public string Id = "", Kind = "";
        public Node3D Root = null!;
        public Node3D? Lining;
        public Aabb Box;
        public float Reach = 90;
        public bool Budgeted;
        public readonly List<Lamp> Lamps = new();
        /// <summary>The middles of its doors and windows: the room shows from the street only near one of them.</summary>
        public readonly List<Vector3> Openings = new();
        public readonly List<GeometryInstance3D> Meshes = new();
        public Vector3 SkyDay, GroundDay, AmbDay, SkyLit, GroundLit, AmbLit;
        public bool? Open;
        public float Level;
        // what its meshes and lamps were last given (set again only when it changes)
        public Vector3 SkyNow = new(-1, 0, 0);
        public float LampK = -1;
    }

    private readonly List<Room> rooms = new();
    private readonly Dictionary<string, Room> byId = new();
    private readonly Dictionary<ShaderMaterial, ShaderMaterial> indoor = new();
    private readonly HashSet<ShaderMaterial> panes = new();
    private double lookT;
    private int maxRooms = 4;

    private static string Key(string s) => Regex.Replace(s, "[^A-Za-z0-9]", "_");

    public override void _Ready()
    {
        I = this;
        ProcessPriority = 42;
        var lit = new Dictionary<string, JsonElement>();
        string town = Main.I.Arg("town", OS.GetEnvironment("SCHELDEMIST_BAKE") is { Length: > 0 } b ? b : ProjectSettings.GlobalizePath("res://baked/town.glb"));
        string name = Path.GetFileNameWithoutExtension(town) + "_lights.json";
        string? file = new[] { Path.Combine(Path.GetDirectoryName(town) ?? ".", name), ProjectSettings.GlobalizePath("res://baked/" + name) }.FirstOrDefault(File.Exists);
        if (file != null && JsonDocument.Parse(File.ReadAllText(file)).RootElement.TryGetProperty("rooms", out var list))
            foreach (var r in list.EnumerateArray()) lit[r.GetProperty("id").GetString() ?? ""] = r.GetProperty("lights");

        var linings = new Dictionary<string, Node3D>();
        foreach (var n in BakedWorld.All(Main.I.World))
            if (n is Node3D n3 && n.Name.ToString().StartsWith("house_lining_")) linings[Key(n.Name.ToString()["house_lining_".Length..])] = n3;
        foreach (var n in BakedWorld.All(Main.I.World).ToList())
        {
            if (n is not Node3D root || !n.HasMeta("extras")) continue;
            var ex = n.GetMeta("extras").AsGodotDictionary();
            if (!ex.TryGetValue("room", out var rv)) continue;
            var info = JsonDocument.Parse(Json.Stringify(rv)).RootElement;
            var room = new Room { Id = info.GetProperty("id").GetString() ?? "", Root = root, Reach = info.GetProperty("reach").GetSingle(), Budgeted = info.GetProperty("budgeted").GetBoolean() };
            room.Kind = room.Id.Contains(':') ? room.Id[..room.Id.IndexOf(':')] : room.Id == "poesje" ? "poesje" : "hall";
            linings.TryGetValue(Key(room.Id), out room.Lining);
            foreach (var o in info.GetProperty("openings").EnumerateArray())
            {
                var c = o.GetProperty("centre");
                room.Openings.Add(new Vector3(c[0].GetSingle(), c[1].GetSingle(), c[2].GetSingle()));
            }
            Dress(room);
            Light(room, info.GetProperty("lights"), lit.TryGetValue(room.Id, out var l) ? l : (JsonElement?)null);
            rooms.Add(room);
            byId[room.Id] = room;
        }
        if (rooms.Count == 0) GD.Print("rooms: none in this bake (bake again: the rooms go into the export as ROOM_<id>)");
        else GD.Print($"rooms: {rooms.Count} in the world ({rooms.Sum(r => r.Meshes.Count)} meshes, {rooms.Sum(r => r.Lamps.Count)} lamps, {rooms.Count(r => r.Lining != null)} linings, {panes.Count} glass)");
        // (dev: --rooms-list prints each room's box, to find a place to look from)
        if (Main.I.Arg("rooms-list") != "")
            foreach (var r in rooms) GD.Print($"room {r.Id} {r.Kind}: {r.Box.GetCenter().Round()} size {r.Box.Size.Round()}, door {(r.Openings.Count > 0 ? r.Openings[0].Round() : Vector3.Zero)}");
        Menu.Prefs.Changed += _ => maxRooms = (int)Menu.Prefs.Num("rooms");
        maxRooms = (int)Menu.Prefs.Num("rooms");
    }

    /// <summary>The shops' and taverns' part says a room is open (its lamps lit after dark) or shut.</summary>
    public void SetOpen(string id, bool open)
    {
        if (byId.TryGetValue(id, out var r)) r.Open = open;
    }

    /// <summary>The room a point is in (its box), or null on the street: no rain falls in it.</summary>
    public Aabb? Around(Vector3 p)
    {
        foreach (var r in rooms)
            if (r.Box.HasPoint(p)) return r.Box;
        return null;
    }

    /// <summary>How lit the room at a point is now, 0..1 (its windows' light on the street follows it); 1 where no room is.</summary>
    public float LitAt(Vector3 p)
    {
        foreach (var r in rooms)
            if (r.Budgeted && r.Box.Grow(1.2f).HasPoint(p)) return r.Level;
        return 1;
    }

    /// <summary>The room's meshes: the indoor material, the room's layer; its copies of the door hidden; its glass found.</summary>
    private void Dress(Room room)
    {
        bool first = true;
        foreach (var n in BakedWorld.All(room.Root))
        {
            // (the room's scene carried the door's leaf and the transom again, for its own pass: here the street's serve)
            if (n is Node3D g && n is not GeometryInstance3D && n.GetParent() is Node3D parent && parent.Name.ToString().EndsWith("_in") && parent.Name.ToString().StartsWith("house_") && !n.Name.ToString().Contains("punch")) g.Visible = false;
            if (n is not GeometryInstance3D gi) continue;
            Mesh? mesh = n is MeshInstance3D mi ? mi.Mesh : n is MultiMeshInstance3D mm ? mm.Multimesh?.Mesh : null;
            if (mesh == null) continue;
            var box = gi.GlobalTransform * gi.GetAabb();
            if (gi.IsVisibleInTree() && box.Size.Length() < 400)
            {
                room.Box = first ? box : room.Box.Merge(box);
                first = false;
            }
            // (on the rooms' own layer only: the mirrors leave it out, as the browser's show a room's dark lining)
            gi.Layers = RoomLayer;
            room.Meshes.Add(gi);
            for (int s = 0; s < mesh.GetSurfaceCount(); s++)
            {
                if (mesh.SurfaceGetMaterial(s) is not ShaderMaterial m) continue;
                if (indoor.ContainsValue(m) || Psx.KindOf(m.Shader) is not { } kind) continue;
                if (kind.Unlit)
                {
                    // the window glass (houseInWorld.ts pane): see-through, no name, a fifth as dense as the air
                    if (kind.Blend && !kind.Add && kind.TwoSided && MathF.Abs(m.GetShaderParameter("albedo").AsColor().A - 0.22f) < 0.02f) panes.Add(m);
                    continue;
                }
                if (!indoor.TryGetValue(m, out var im))
                {
                    im = (ShaderMaterial)m.Duplicate();
                    im.Shader = Psx.ShaderOf(kind with { Indoor = true });
                    indoor[m] = im;
                }
                mesh.SurfaceSetMaterial(s, im);
            }
        }
    }

    private static Vector3 Col(JsonElement l, string key = "color")
    {
        var c = Psx.Hex((int)l.GetProperty(key).GetDouble());
        return new Vector3(c.R, c.G, c.B);
    }

    /// <summary>The room's own lights: by day as the bake found them, lit as the bake's night lights have them.</summary>
    private void Light(Room room, JsonElement day, JsonElement? lit)
    {
        var d = day.EnumerateArray().ToList();
        var n = lit?.EnumerateArray().ToList();
        for (int i = 0; i < d.Count; i++)
        {
            var l = d[i];
            JsonElement? ln = n != null && i < n.Count ? n[i] : null;
            string type = l.GetProperty("type").GetString() ?? "";
            float di = l.GetProperty("intensity").GetSingle(), ni = ln?.GetProperty("intensity").GetSingle() ?? di;
            // (three's lights give colour x intensity / pi on a matt face)
            if (type == "HemisphereLight")
            {
                room.SkyDay = Col(l) * di / MathF.PI;
                room.GroundDay = Col(l, "ground") * di / MathF.PI;
                room.SkyLit = Col(ln ?? l) * ni / MathF.PI;
                room.GroundLit = Col(ln ?? l, "ground") * ni / MathF.PI;
            }
            else if (type == "AmbientLight")
            {
                room.AmbDay = Col(l) * di / MathF.PI;
                room.AmbLit = Col(ln ?? l) * ni / MathF.PI;
            }
            else if (type == "PointLight" && Math.Max(di, ni) > 0.01f)
            {
                var p = (ni > di ? ln!.Value : l).GetProperty("pos");
                var c = Col(ni > di ? ln!.Value : l);
                float range = l.GetProperty("distance").ValueKind == JsonValueKind.Number ? l.GetProperty("distance").GetSingle() : 0;
                // three's point light and Godot's fall off alike: distance^-decay, cut to nothing at its range
                var o = new OmniLight3D
                {
                    LightColor = new Color(c.X, c.Y, c.Z), LightEnergy = 0, OmniRange = range > 0 ? range : 40,
                    OmniAttenuation = l.GetProperty("decay").ValueKind == JsonValueKind.Number ? l.GetProperty("decay").GetSingle() : 2,
                    ShadowEnabled = false, LightCullMask = RoomLayer, LightSpecular = 0,
                };
                Main.I.View.AddChild(o);
                o.GlobalPosition = new Vector3(p[0].GetSingle(), p[1].GetSingle(), p[2].GetSingle());
                room.Lamps.Add(new Lamp { Light = o, Day = di / MathF.PI, Lit = ni / MathF.PI });
            }
        }
    }

    public override void _Process(double delta)
    {
        var day = Daylight.I;
        var cam = Main.I.View.GetCamera3D();
        if (day == null || cam == null || rooms.Count == 0) return;
        float h = day.Hour, night = day.Night;
        float dayK = Mathf.Clamp(h < 12 ? (h - 6.5f) / 3 : (18.5f - h) / 3, 0, 1);
        var eye = cam.GlobalPosition;
        // which rooms are shown: within reach of the eye (a house: the nearest few, the settings' "rooms"); the rest
        // show their dark lining. Looked at four times a second.
        lookT -= delta;
        if (lookT <= 0)
        {
            lookT = 0.25;
            float far = day.FogFar + 10;
            float Near(Room r) => r.Box.HasPoint(eye) ? 0 : r.Openings.Count == 0 ? Dist(r.Box, eye) : r.Openings.Min(o => o.DistanceTo(eye));
            var near = rooms.Where(r => r.Budgeted).Select(r => (r, d: Near(r))).Where(x => x.d < Math.Min(x.r.Reach, far)).OrderBy(x => x.d).Take(Math.Max(1, maxRooms) * 2).Select(x => x.r).ToHashSet();
            foreach (var r in rooms)
            {
                // (a hall is seen as far as the fog lets its nearest opening show)
                bool show = r.Budgeted ? near.Contains(r) : Near(r) < Math.Min(r.Reach, far);
                if (r.Root.Visible != show) r.Root.Visible = show;
                if (r.Lining != null && r.Lining.Visible == show) r.Lining.Visible = !show;
            }
        }
        foreach (var r in rooms)
        {
            // open: its lamps lit after dark; shut: out. A hall is lit all night.
            bool open = r.Open ?? r.Kind switch { "shop" => h >= 7 && h < 19, "tavern" => h >= 10, "poesje" => h >= 18.5f && h < 22.5f, "home" => false, _ => true };
            float target = open ? 1 : 0;
            r.Level += (target - r.Level) * Math.Min(1, (float)delta * 2);
            if (!r.Root.Visible)
            {
                if (r.LampK != -2) foreach (var l in r.Lamps) l.Light.LightEnergy = 0;
                r.LampK = -2;
                continue;
            }
            float k = night * r.Level;
            if (MathF.Abs(k - r.LampK) > 0.004f || r.Level is > 0.001f and < 0.999f)
            {
                r.LampK = k;
                foreach (var l in r.Lamps) l.Light.LightEnergy = Mathf.Lerp(l.Day * (r.Budgeted ? r.Level : 1), l.Lit, k);
            }
            // from the bright street by day a room looks dim through its windows
            bool inside = r.Box.HasPoint(eye);
            float dim = inside ? 1 : 1 - 0.45f * dayK;
            var sky = r.SkyDay.Lerp(r.SkyLit, night) * dim;
            var ground = r.GroundDay.Lerp(r.GroundLit, night) * dim;
            var amb = r.AmbDay.Lerp(r.AmbLit, night) * dim;
            if (sky.DistanceSquaredTo(r.SkyNow) < 1e-7f) continue;
            r.SkyNow = sky;
            foreach (var m in r.Meshes)
            {
                m.SetInstanceShaderParameter("room_sky", sky);
                m.SetInstanceShaderParameter("room_ground", ground);
                m.SetInstanceShaderParameter("room_ambient", amb);
            }
        }
        // the glass: a little of the sky on it from outside by day (the street's air, by the square of the daylight)
        var fog = day.FogColor * 2.2f;
        var glass = new Color(fog.R, fog.G, fog.B, 0.06f + 0.22f * dayK * dayK);
        foreach (var m in panes) m.SetShaderParameter("albedo", glass);
    }

    private static float Dist(Aabb box, Vector3 p)
    {
        var c = new Vector3(Mathf.Clamp(p.X, box.Position.X, box.End.X), Mathf.Clamp(p.Y, box.Position.Y, box.End.Y), Mathf.Clamp(p.Z, box.Position.Z, box.End.Z));
        return c.DistanceTo(p);
    }
}

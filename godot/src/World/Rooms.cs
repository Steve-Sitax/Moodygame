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
/// Open or shut: each shop's and tavern's own hours as the server has them (asked every 15 s, as interiors.ts does:
/// /api/shops and /api/interiors), or a part that knows sooner (SetOpen); until the first answer by the clock (a shop
/// 7 to 19, a tavern 10 to 24). A shut tavern's lamps are out, as in the browser (setLamps 0).
/// Not yet: the room's own air when the eye is inside (the street's fog is used), people inside lit by the room.
/// </summary>
[GamePart(50)]
public partial class Rooms : Node, Dev.IInteriorAuditSource
{
    public static Rooms I { get; private set; } = null!;
    /// <summary>The rooms' meshes: their lamps light only these.</summary>
    public const uint RoomLayer = 1u << 12;

    private sealed class Lamp
    {
        public OmniLight3D Light = null!;
        public float Day, Lit;
        /// <summary>A stove's or a hearth's glow (the bake's orange fire light, low in the room): it burns by day too.</summary>
        public bool Fire;
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
        public readonly List<(string kind, Aabb box, bool open)> AuditOpenings = new();
        public readonly List<GeometryInstance3D> Meshes = new();
        /// <summary>The sun's shafts in a hall (hallSun.ts hall_sun_shafts): light in the hall's air, shown only from inside.</summary>
        public readonly List<GeometryInstance3D> Shafts = new();
        public bool? ShaftsOn;
        public Vector3 SkyDay, GroundDay, AmbDay, SkyLit, GroundLit, AmbLit;
        public bool? Open;
        public float Level;
        // what its meshes and lamps were last given (set again only when it changes)
        public Vector3 SkyNow = new(-1, 0, 0);
        public float LampK = -1, LampOn = -1;
        // the street's copy of the door: its transom glass (unlit) and its warm glow (additive), houseInWorld.ts
        public readonly List<ShaderMaterial> Transoms = new();
        public readonly List<(GeometryInstance3D g, ShaderMaterial m)> Glows = new();
        public float TransomK = -1;
    }

    private readonly List<Room> rooms = new();
    private readonly Dictionary<string, Room> byId = new();
    private readonly Dictionary<ShaderMaterial, ShaderMaterial> indoor = new();
    private readonly HashSet<ShaderMaterial> panes = new();
    /// <summary>The halls' sun patches (hallSun.ts hall_sun_light): each material with the colour of full sun.</summary>
    private readonly Dictionary<ShaderMaterial, Color> sunPatches = new();
    private readonly Dictionary<ShaderMaterial, ShaderMaterial> sunPatchOf = new();
    private float sunPatchK = -1;
    /// <summary>The halls' sun shafts (hallSun.ts hall_sun_shafts): their additive material, set from the same sun as the patches.</summary>
    private readonly HashSet<ShaderMaterial> shaftMats = new();
    private Vector2 shaftK = new(-1, -1);
    /// <summary>The browser's patch lights what is under it by its own colour (dst * (1 + src)); drawn as alpha it covered
    /// the floor with the black of its unlit texels (issue 74). Added to the floor instead, at a floor's tone of about a third.</summary>
    private const float PatchTone = 0.33f;
    private double lookT;
    private int maxRooms = 4;
    private readonly List<(Room room, float distance, int index)> candidates = new();
    private readonly HashSet<Room> selected = new();
    private readonly List<Dev.InteriorAuditTarget> auditTargets = new();
    public IReadOnlyList<Dev.InteriorAuditTarget> InteriorAuditTargets => auditTargets;
    /// <summary>A visibility check pins its room while visiting its openings; normal distance culling resumes afterwards.</summary>
    public string? AuditRoom { get; set; }
    private readonly string off = Main.I.Arg("room-off");

    private static string Key(string s) => Regex.Replace(s, "[^A-Za-z0-9]", "_");

    public override void _Ready()
    {
        I = this;
        ProcessPriority = 42;
        var lit = new Dictionary<string, JsonElement>();
        string town = Main.I.Arg("town", OS.GetEnvironment("SCHELDEMIST_BAKE") is { Length: > 0 } b ? b : ProjectSettings.GlobalizePath("res://baked/town.glb"));
        string name = Path.GetFileNameWithoutExtension(town) + "_lights.json";
        string? file = new[] { Path.Combine(Path.GetDirectoryName(town) ?? ".", name), ProjectSettings.GlobalizePath("res://baked/" + name) }.FirstOrDefault(File.Exists);
        var nativeLights = Main.I.World.NativeLights;
        if ((nativeLights ?? (file != null ? JsonDocument.Parse(File.ReadAllText(file)) : null))?.RootElement is { } lightRoot && lightRoot.TryGetProperty("rooms", out var list))
            foreach (var r in list.EnumerateArray()) lit[r.GetProperty("id").GetString() ?? ""] = r.GetProperty("lights");

        var linings = new Dictionary<string, Node3D>();
        var houses = new Dictionary<string, Node3D>();
        foreach (var n in BakedWorld.All(Main.I.World))
            if (n is Node3D h3 && n.Name.ToString().StartsWith("house_") && !n.Name.ToString().StartsWith("house_lining_")) houses.TryAdd(n.Name.ToString(), h3);
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
                var openingBox = o.GetProperty("box");
                var min = new Vector3(openingBox[0].GetSingle(), openingBox[1].GetSingle(), openingBox[2].GetSingle());
                var max = new Vector3(openingBox[3].GetSingle(), openingBox[4].GetSingle(), openingBox[5].GetSingle());
                room.AuditOpenings.Add((o.GetProperty("kind").GetString() ?? "window", new Aabb(min, max - min), o.GetProperty("open").GetBoolean()));
            }
            Dress(room);
            if (houses.TryGetValue("house_" + Key(room.Id), out var house)) Doors(room, house);
            Light(room, info.GetProperty("lights"), lit.TryGetValue(room.Id, out var l) ? l : (JsonElement?)null);
            AddedLamps(room);
            if(Main.I.World.NativeFurnitureRooms?.Contains(room.Id)==true)
            {
                var availableLights=room.Lamps.ToList();
                foreach(var furniture in Main.I.World.NativeFurniture!.Where(p=>p.Room==room.Id && p.Kind is "stove" or "lamp").OrderBy(p=>p.Id,StringComparer.Ordinal))
                {
                    if(availableLights.Count==0)break;
                    var lamp=availableLights.OrderBy(l=>l.Light.GlobalPosition.DistanceSquaredTo(furniture.LightAt)).First();availableLights.Remove(lamp);
                    lamp.Light.GlobalPosition=furniture.LightAt;
                }
            }
            rooms.Add(room);
            byId[room.Id] = room;
        }
        var markers = BakedWorld.All(Main.I.World).OfType<Node3D>().Where(n => n.Name.ToString().StartsWith("opening_") && n.HasMeta("extras") && n.GetMeta("extras").AsGodotDictionary().ContainsKey("kind")).ToArray();
        foreach (var r in rooms)
        {
            // The browser room registry calls slits and roof lights windows; shell markers retain their precise kind.
            var openings = markers.Where(n => r.AuditOpenings.Any(o => o.kind == (n.GetMeta("extras").AsGodotDictionary()["kind"].AsString() == "door" ? "door" : "window") && o.box.Grow(0.15f).HasPoint(n.GlobalPosition))).ToArray();
            // City walls are shared chunks, rather than children of a house's marker group.
            var bounds = r.Box;
            foreach (var o in r.AuditOpenings) bounds = bounds.Merge(o.box);
            var shut = openings.Where(n => r.AuditOpenings.Any(o => o.kind == "door" && !o.open && o.box.Grow(0.15f).HasPoint(n.GlobalPosition))).ToArray();
            auditTargets.Add(new(r.Id, Main.I.World, r.Root, openings, bounds, r.AuditOpenings.Select(o => o.box).ToArray(), shut));
        }
        // (the browser's punch cut the street's house open for a room drawn as a scene of its own; here the rooms stand
        // in the world behind real openings, so the punch has nothing to do)
        Main.I.World.Unported.RemoveAll(u => u.StartsWith("house_") && u.Contains("_punch/"));
        if (rooms.Count == 0) GD.Print("rooms: none in this bake (bake again: the rooms go into the export as ROOM_<id>)");
        else GD.Print($"rooms: {rooms.Count} in the world ({rooms.Sum(r => r.Meshes.Count)} meshes, {rooms.Sum(r => r.Lamps.Count)} lamps, {rooms.Count(r => r.Lining != null)} linings, {panes.Count} glass)");
        // (dev: --rooms-list prints each room's box, to find a place to look from)
        if (Main.I.Arg("rooms-list") != "")
            foreach (var r in rooms) GD.Print($"room {r.Id} {r.Kind}: {r.Box.GetCenter().Round()} size {r.Box.Size.Round()}, door {(r.Openings.Count > 0 ? r.Openings[0].Round() : Vector3.Zero)}; sky {r.SkyDay} / {r.SkyLit}, ambient {r.AmbDay} / {r.AmbLit}, lamps {string.Join(" ", r.Lamps.Select(l => $"{l.Day:0.##}/{l.Lit:0.##}@{l.Light.GlobalPosition.Y:0.#}"))}");
        Menu.Prefs.Changed += _ => maxRooms = (int)Menu.Prefs.Num("rooms");
        maxRooms = (int)Menu.Prefs.Num("rooms");
    }

    private float askT = 1;
    private bool asking;

    /// <summary>Which shops and taverns are open now, from the server (each its own hours; the Poesje's evening).</summary>
    private async void AskOpen()
    {
        if (asking || Net.ServerLink.I?.Api is not { } api) return;
        asking = true;
        try
        {
            if (Talks.Shop.I != null)
                foreach (var shop in await Talks.Shop.I.List()) SetOpen("shop:" + shop.Place, shop.Open);
            var j = await api.Get<JsonElement>("api/interiors");
            if (j.TryGetProperty("taverns", out var ts))
                foreach (var t in ts.EnumerateArray()) SetOpen(t.GetProperty("place").GetString() ?? "", t.GetProperty("open").GetBoolean());
            if (j.TryGetProperty("poesje", out var p) && p.ValueKind == JsonValueKind.Object) SetOpen("poesje", p.GetProperty("open").GetBoolean());
        }
        catch (Exception)
        {
            // (no answer: the last word stands, or the clock)
        }
        finally
        {
            asking = false;
            asks++;
        }
    }

    /// <summary>The server's last word on a shop's or tavern's room: open, shut, or not known yet.</summary>
    public bool? IsOpen(string id) => byId.TryGetValue(id, out var r) ? r.Open : null;

    /// <summary>The shops' and taverns' part says a room is open (its lamps lit after dark) or shut.</summary>
    public void SetOpen(string id, bool open)
    {
        if (byId.TryGetValue(id, out var r)) { r.Open = open; answered++; }
        else unknown.Add(id);
    }

    private int answered, asks;
    private readonly HashSet<string> unknown = new();
    private double hoursT = -1;
    private string? hoursDir;

    /// <summary>
    /// Dev, --roomhours dir: the rooms' hours from the server proven. Once the server has answered twice, writes
    /// dir/roomhours.json (the clock, each room's word from the server, what the clock alone would have said, its
    /// light now; the server's places with no room) and quits.
    /// </summary>
    private void RoomHours(float h, double delta)
    {
        string dir = hoursDir ??= Paths.TestOutput("roomhours");
        if (dir == "" || asks < 2 || asking) return;
        if (hoursT < 0) hoursT = 3;
        hoursT -= delta;
        if (hoursT > 0) return;
        System.IO.Directory.CreateDirectory(dir);
        var list = rooms.Where(r => r.Kind != "home").Select(r => new
        {
            r.Id, r.Kind, server = r.Open, clock = r.Kind switch { "shop" => h >= 7 && h < 19, "tavern" => h >= 10, "poesje" => h >= 18.5f && h < 22.5f, "home" => false, _ => true },
            level = Math.Round(r.Level, 2),
        }).ToList();
        var report = new
        {
            hour = Math.Round(h, 2), asks, answered, rooms = list.Count, fromServer = list.Count(r => r.server != null), noAnswer = list.Where(r => r.server == null).Select(r => r.Id),
            differFromClock = list.Where(r => r.server != null && r.server != r.clock).Select(r => $"{r.Id}: server {(r.server == true ? "open" : "shut")}, clock {(r.clock ? "open" : "shut")}"),
            serverPlacesWithoutRoom = unknown.Order(), list,
        };
        System.IO.File.WriteAllText(System.IO.Path.Combine(dir, "roomhours.json"), System.Text.Json.JsonSerializer.Serialize(report, new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
        GD.Print($"roomhours: {report.fromServer} of {report.rooms} rooms answered by the server at {h:0.00}, {report.differFromClock.Count()} differ from the clock alone");
        GetTree().Quit();
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

    /// <summary>The street's door of a room: its transom glass and the warm glow behind it (houseInWorld.ts transomMat, glowMesh).</summary>
    private static void Doors(Room room, Node3D house)
    {
        foreach (var n in BakedWorld.All(house))
        {
            if (n is not GeometryInstance3D gi) continue;
            Mesh? mesh = n is MeshInstance3D mi ? mi.Mesh : null;
            if (mesh == null || mesh.GetSurfaceCount() == 0 || mesh.SurfaceGetMaterial(0) is not ShaderMaterial m || Psx.KindOf(m.Shader) is not { Unlit: true } k) continue;
            if (k.Add) room.Glows.Add((gi, m));
            else if (!k.Blend && m.GetShaderParameter("tex").Obj == null && !room.Transoms.Contains(m)) room.Transoms.Add(m);
        }
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
            if (gi.Name.ToString().Contains("hall_sun_shafts")) room.Shafts.Add(gi);
            for (int s = 0; s < mesh.GetSurfaceCount(); s++)
            {
                if (mesh.SurfaceGetMaterial(s) is not ShaderMaterial m) continue;
                if (indoor.ContainsValue(m) || Psx.KindOf(m.Shader) is not { } kind) continue;
                if (gi.Name.ToString().Contains("hall_sun_shafts") && kind is { Unlit: true, Add: true })
                {
                    // (the shafts keep their own additive material; its strength follows the sun below, as hallSun.ts set)
                    if (shaftMats.Add(m)) shaftK = new Vector2(-1, -1);
                    continue;
                }
                if (kind.Unlit && m.ResourceName == "hall_sun_light" && kind is { Blend: true, Add: false })
                {
                    // (the sun's patch on a hall's floor and walls: the shafts' own shader kind, added, not mixed; the
                    // strength follows the sun below, as hallSun.ts set(day, sky))
                    if (!sunPatchOf.TryGetValue(m, out var pm))
                    {
                        pm = (ShaderMaterial)m.Duplicate();
                        pm.Shader = Psx.ShaderOf(kind with { Add = true, TwoSided = true });
                        sunPatchOf[m] = pm;
                        sunPatches[pm] = m.GetShaderParameter("albedo").AsColor();
                        sunPatchK = -1;
                        Scheldemist.Render.UniformUpdates.Material(pm, "albedo", new Color(0, 0, 0, 1));
                    }
                    mesh.SurfaceSetMaterial(s, pm);
                    continue;
                }
                if (kind.Unlit)
                {
                    // the window glass (houseInWorld.ts pane): see-through, no picture, thin (0.03 to 0.28: the bake
                    // took it at whatever its sheen was then; it is set again every frame below)
                    float pa = m.GetShaderParameter("albedo").AsColor().A;
                    if (kind.Blend && !kind.Add && kind.TwoSided && !kind.DepthWrite && m.GetShaderParameter("tex").Obj == null && pa > 0.02f && pa < 0.4f) panes.Add(m);
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
                // (a Godot light reads its colour as sRGB, as the bake's hex is: not Col's linear one)
                int hex = (int)(ni > di ? ln!.Value : l).GetProperty("color").GetDouble();
                float range = l.GetProperty("distance").ValueKind == JsonValueKind.Number ? l.GetProperty("distance").GetSingle() : 0;
                // three's point light and Godot's fall off alike: distance^-decay, cut to nothing at its range
                var o = new OmniLight3D
                {
                    LightColor = new Color(((hex >> 16) & 255) / 255f, ((hex >> 8) & 255) / 255f, (hex & 255) / 255f), LightEnergy = 0, OmniRange = range > 0 ? range : 40,
                    OmniAttenuation = l.GetProperty("decay").ValueKind == JsonValueKind.Number ? l.GetProperty("decay").GetSingle() : 2,
                    ShadowEnabled = false, LightCullMask = RoomLayer, LightSpecular = 0,
                };
                Main.I.View.AddChild(o);
                o.GlobalPosition = new Vector3(p[0].GetSingle(), p[1].GetSingle(), p[2].GetSingle());
                bool fire = o.LightColor.G < 0.62f;
                // (#137) a lamp in a tavern, a shop or a home throws a pool round it, not an even light to the far wall
                float gain = 1;
                if (room.Kind != "hall" && !fire && o.OmniAttenuation < RoomLampDecay) { o.OmniAttenuation = RoomLampDecay; gain = RoomLampGain; }
                room.Lamps.Add(new Lamp { Light = o, Day = di / MathF.PI * gain, Lit = ni / MathF.PI * gain, Fire = fire });
            }
        }
    }

    /// <summary>Lamps a room has that the bake did not light (#198: the cathedral's aisles were dark at night by the confessionals):
    /// the flames of its standing lamps (church/lamp_stand, drawn by room-cathedral-source-8902-4), each lit as the transept altar's
    /// candle light is (its colour and fall-off; a little weaker), out by day. A room keeps at most ROOM_POINT_LIGHTS (10) lamps:
    /// the cathedral had eight.</summary>
    public static readonly Dictionary<string, Vector3[]> ExtraLamps = new()
    {
        ["cathedral"] = new[] { new Vector3(-239.45f, 2.27f, 183.35f), new Vector3(-284.55f, 2.27f, 180.45f) },
    };
    private void AddedLamps(Room room)
    {
        if (!ExtraLamps.TryGetValue(room.Id, out var flames)) return;
        foreach (var at in flames)
        {
            if (room.Lamps.Count >= 10) { GD.PushWarning($"rooms: {room.Id} has its ten lamps; the lamp at {at} is not lit"); break; }
            var o = new OmniLight3D
            {
                LightColor = new Color(1f, 0xa8 / 255f, 0x60 / 255f), LightEnergy = 0, OmniRange = 9, OmniAttenuation = 1.5f,
                ShadowEnabled = false, LightCullMask = RoomLayer, LightSpecular = 0,
            };
            Main.I.View.AddChild(o);
            o.GlobalPosition = at;
            room.Lamps.Add(new Lamp { Light = o, Day = 0, Lit = 6.5f / MathF.PI, Fire = false });
        }
    }

    public override void _Process(double delta)
    {
        using var frameCost = Scheldemist.Dev.FrameCost.Track("Rooms");
        var day = Daylight.I;
        var cam = Main.I.View.GetCamera3D();
        if (day == null || cam == null || rooms.Count == 0) return;
        askT -= (float)delta;
        if (askT <= 0)
        {
            askT = (hoursDir ??= Paths.TestOutput("roomhours")) != "" ? 4 : 15;
            AskOpen();
        }
        float h = day.Hour, night = day.Night;
        RoomHours(h, delta);
        float dayK = Mathf.Clamp(h < 12 ? (h - 6.5f) / 3 : (18.5f - h) / 3, 0, 1);
        // the daylight that comes in by a room's windows: the sky's cold light, as strong as the sky outside
        var window = RoomWindowSky * (RoomWindowShare * day.SkyIntensity / MathF.PI * (1 - night));
        var eye = cam.GlobalPosition;
        // which rooms are shown: within reach of the eye (a house: the nearest few, the settings' "rooms"); the rest
        // show their dark lining. Looked at four times a second.
        lookT -= delta;
        if (lookT <= 0 || AuditRoom != null)
        {
            lookT = 0.25;
            float far = day.FogFar + 10;
            var near = Scheldemist.Dev.SpeedComparison.Cached ? SelectCached(eye, far) : SelectOriginal(eye, far);
            foreach (var r in rooms)
            {
                // (a hall is seen as far as the fog lets its nearest opening show)
                bool show = AuditRoom != null ? r.Id == AuditRoom : r.Budgeted ? near.Contains(r) : Near(r, eye) < Math.Min(r.Reach, far);
                if (off.Contains("meshes")) show = false;
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
            // the door's transom takes the sky's light; at night, the door open, it glows warm (houseInWorld.ts update)
            {
                float lit = r.Level * Mathf.Clamp((0.45f - dayK) / 0.25f, 0, 1) * night;
                float skyL = 0.06f + 0.94f * dayK;
                float tk = lit * 10 + skyL;
                if (MathF.Abs(tk - r.TransomK) > 0.003f)
                {
                    r.TransomK = tk;
                    var tc = new Color(0.11f * skyL + 0.5f * lit, 0.13f * skyL + 0.34f * lit, 0.16f * skyL + 0.12f * lit).LinearToSrgb();
                    foreach (var m in r.Transoms) Scheldemist.Render.UniformUpdates.Material(m, "albedo", tc);
                    foreach (var (g, m) in r.Glows)
                    {
                        g.Visible = lit > 0.01f;
                        var a = m.GetShaderParameter("albedo").AsColor();
                        Scheldemist.Render.UniformUpdates.Material(m, "albedo", new Color(a.R, a.G, a.B, lit * 0.8f));
                    }
                }
            }
            if (!r.Root.Visible)
            {
                if (r.LampK != -2) foreach (var l in r.Lamps) l.Light.LightEnergy = 0;
                r.LampK = -2;
                continue;
            }
            float k = night * r.Level;
            // (#137) the bake gave every room the same lights by day and by night: by day the lamps are out and only a
            // stove or a hearth burns; they are lit as the dark comes (a hall keeps its own light all day)
            bool hall = r.Kind == "hall";
            float lampsOn = hall ? 1 : night;
            if (MathF.Abs(k - r.LampK) > 0.004f || MathF.Abs(lampsOn - r.LampOn) > 0.004f || r.Level is > 0.001f and < 0.999f)
            {
                r.LampK = k;
                r.LampOn = lampsOn;
                foreach (var l in r.Lamps) l.Light.LightEnergy = off.Contains("lamps") ? 0 : Mathf.Lerp(l.Day * (r.Budgeted ? r.Level : 1), l.Lit, k) * (l.Fire ? 1 : lampsOn);
            }
            // from the bright street by day a room looks dim through its windows
            bool inside = r.Box.HasPoint(eye);
            // (the look survey's point 20: from the street the shafts stood as white sheets in the windows and the doors)
            if (r.Shafts.Count > 0 && r.ShaftsOn != inside)
            {
                r.ShaftsOn = inside;
                foreach (var g in r.Shafts) g.Visible = inside;
            }
            float dim = inside ? 1 : 1 - 0.45f * dayK;
            Vector3 sky, ground, amb;
            if (hall)
            {
                sky = r.SkyDay.Lerp(r.SkyLit, night) * dim;
                ground = r.GroundDay.Lerp(r.GroundLit, night) * dim;
                amb = r.AmbDay.Lerp(r.AmbLit, night) * dim;
            }
            else
            {
                // (#137) by day the day's own cold light comes in by the windows over the room's warm half-light; after
                // dark the room's fill drops, so the lamps and the stove light it in warm pools with dark corners
                sky = (r.SkyDay * RoomDayKeep + window).Lerp(r.SkyLit * RoomNightFill, night) * dim;
                ground = (r.GroundDay * RoomDayKeep + window * RoomWindowFloor).Lerp(r.GroundLit * RoomNightFill, night) * dim;
                amb = (r.AmbDay * RoomDayKeep + window * RoomWindowAmbient).Lerp(r.AmbLit * RoomNightFill, night) * dim;
            }
            if (sky.DistanceSquaredTo(r.SkyNow) < 1e-7f) continue;
            r.SkyNow = sky;
            foreach (var m in r.Meshes)
            {
                m.SetInstanceShaderParameter("room_sky", sky);
                m.SetInstanceShaderParameter("room_ground", ground);
                m.SetInstanceShaderParameter("room_ambient", amb);
            }
        }
        // the sun's patches and shafts in the halls: only by day in clear or thin weather, a faint moon on clear nights
        // (hallSun.ts set); one rule for both
        {
            var (sunK, moonK) = HallSun(day, dayK);
            if (MathF.Abs(sunK - sunPatchK) > 0.004f)
            {
                sunPatchK = sunK;
                foreach (var (m, full) in sunPatches)
                    Scheldemist.Render.UniformUpdates.Material(m, "albedo", new Color(full.R * sunK * PatchTone, full.G * sunK * PatchTone, full.B * sunK * PatchTone, 1));
            }
            if (MathF.Abs(sunK - shaftK.X) > 0.004f || MathF.Abs(moonK - shaftK.Y) > 0.004f)
            {
                shaftK = new Vector2(sunK, moonK);
                var shaft = ShaftSun * (0.22f * sunK) + ShaftMoon * (0.035f * moonK);
                // (the colour is set as the shader reads it, sRGB: the light adds in linear)
                var c = new Color(shaft.X, shaft.Y, shaft.Z, 1).LinearToSrgb();
                foreach (var m in shaftMats) Scheldemist.Render.UniformUpdates.Material(m, "albedo", c);
            }
        }
        // the glass: a little of the sky on it from outside by day (the street's air, by the square of the daylight)
        var fog = day.FogColor * 2.2f;
        var glass = new Color(fog.R, fog.G, fog.B, 0.06f + 0.22f * dayK * dayK);
        foreach (var m in panes) Scheldemist.Render.UniformUpdates.Material(m, "albedo", glass);
    }

    /// <summary>
    /// A room by the clock (#137): by day it keeps this much of its own warm fill and takes the sky's light through its
    /// windows (a share of the street's sky light, cold; some of it on the floor and in the air); after dark its fill
    /// drops to RoomNightFill, so its lamps and stove show as warm pools.
    /// </summary>
    private const float RoomDayKeep = 0.55f, RoomWindowShare = 0.45f, RoomWindowFloor = 0.35f, RoomWindowAmbient = 0.2f, RoomNightFill = 0.22f;
    /// <summary>A room lamp's fall-off (a pool of light: the square of the distance) and the strength that keeps it as bright under it.</summary>
    private const float RoomLampDecay = 2.4f, RoomLampGain = 1.5f;
    private static readonly Vector3 RoomWindowSky = new(0.235f, 0.296f, 0.381f);

    /// <summary>The sun's colour and the moon's in the halls' shafts (hallSun.ts SUN, MOON).</summary>
    private static readonly Vector3 ShaftSun = new(1.0f, 0.93f, 0.8f), ShaftMoon = new(0.42f, 0.55f, 0.85f);

    /// <summary>How much sun and how much moon the halls' light has now (hallSun.ts set(day, sky)): the sun by day in clear
    /// or thin weather, the moon on a clear night, neither in a storm. The patches and the shafts both follow it.</summary>
    private static (float sun, float moon) HallSun(Daylight day, float dayK)
    {
        float bright = Mathf.Clamp(day.Clear / 0.6f, 0, 1);
        float clear = Mathf.Clamp((bright - 0.55f) * 2.2f, 0, 1) * (1 - day.Storm);
        float sunT = Mathf.Clamp(dayK, 0, 1), moonT = Mathf.Clamp(dayK / 0.25f, 0, 1);
        return (sunT * sunT * (3 - 2 * sunT) * clear, (1 - moonT * moonT * (3 - 2 * moonT)) * clear);
    }

    private static float Near(Room r, Vector3 eye)
    {
        if (r.Box.HasPoint(eye)) return 0;
        if (r.Openings.Count == 0) return Dist(r.Box, eye);
        float distance = float.PositiveInfinity;
        foreach (var opening in r.Openings) distance = Math.Min(distance, opening.DistanceTo(eye));
        return distance;
    }
    private HashSet<Room> SelectOriginal(Vector3 eye, float far)
    {
        float NearOriginal(Room r) => r.Box.HasPoint(eye) ? 0 : r.Openings.Count == 0 ? Dist(r.Box, eye) : r.Openings.Min(o => o.DistanceTo(eye));
        return rooms.Where(r => r.Budgeted).Select(r => (r, d: NearOriginal(r))).Where(x => x.d < Math.Min(x.r.Reach, far)).OrderBy(x => x.d).Take(Math.Max(1, maxRooms) * 2).Select(x => x.r).ToHashSet();
    }
    private HashSet<Room> SelectCached(Vector3 eye, float far)
    {
        candidates.Clear(); selected.Clear();
        for (int i = 0; i < rooms.Count; i++)
        {
            var room = rooms[i]; if (!room.Budgeted) continue;
            float distance = Near(room, eye);
            if (distance < Math.Min(room.Reach, far)) candidates.Add((room, distance, i));
        }
        candidates.Sort(static (a, b) => { int order = a.distance.CompareTo(b.distance); return order == 0 ? a.index.CompareTo(b.index) : order; });
        int count = Math.Min(candidates.Count, Math.Max(1, maxRooms) * 2);
        for (int i = 0; i < count; i++) selected.Add(candidates[i].room);
        return selected;
    }
    public bool SameSelection(Vector3 eye) => SelectOriginal(eye, Daylight.I.FogFar + 10).SetEquals(SelectCached(eye, Daylight.I.FogFar + 10));
    public void RepeatVisibility() { lookT = 0; _Process(0); }

    private static float Dist(Aabb box, Vector3 p)
    {
        var c = new Vector3(Mathf.Clamp(p.X, box.Position.X, box.End.X), Mathf.Clamp(p.Y, box.Position.Y, box.End.Y), Mathf.Clamp(p.Z, box.Position.Z, box.End.Z));
        return c.DistanceTo(p);
    }
}

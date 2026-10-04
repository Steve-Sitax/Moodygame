using System;
using System.Collections.Generic;
using System.Text.Json;
using Scheldemist.Town;
using Godot;
using Scheldemist.Game;

namespace Scheldemist.People;

public partial class HallPeople
{
    public void ApplyHall(string id, JsonElement reply) { foreach (var h in Halls) if (h.Id == id) { Roster(h, reply); h.Poll = 5; return; } }
    private readonly List<string> ceremonyGone = new(24);
    public int CeremonyEntered { get; private set; }
    public int CeremonyExited { get; private set; }
    private static bool CeremonyRole(string role) => role is "requiem_priest" or "bearer0" or "bearer1" or "bearer2" or "bearer3" or "widow" or "mourner" or "groom" or "bride" or "guest" or "wedding_priest" or "worshipper" or "faithful" or "preacher" or "c_guest" or "c_groom" or "c_bride";
    private static bool EventRoleForWalk(string role) => role is "requiem_priest" or "bearer0" or "bearer1" or "bearer2" or "bearer3" or "widow" or "mourner" or "groom" or "bride" or "guest" or "wedding_priest";
    private static Vector3 DoorAt(Hall h) => h.Plan.GetProperty("marks").TryGetProperty("door", out var door) ? World(h, door) : h.Origin;
    private static bool EyeInside(Hall h)
    {
        var p = Main.I.Cam.GlobalPosition - h.Origin; double c = Math.Cos(h.Yaw), s = Math.Sin(h.Yaw);
        double x = p.X * c - p.Z * s, z = p.X * s + p.Z * c;
        return h.Id == "cathedral" ? z > 5.65 && z < 140 && Math.Abs(x) < 32 : z > 1.1 && Math.Abs(x) < 35;
    }
    private static List<Vector3> GridRoute(Hall h, Vector3 from, Vector3 to)
    {
        var result = h.RouteResult; result.Clear(); var grid = h.Plan.GetProperty("freeGrid");
        double gx = grid.GetProperty("x").GetDouble(), gz = grid.GetProperty("z").GetDouble(), step = grid.GetProperty("step").GetDouble();
        int width = h.GridRows[0].Length, height = h.GridRows.Length;
        int Cell(Vector3 point) { var p = point - h.Origin; double c = Math.Cos(h.Yaw), s = Math.Sin(h.Yaw); int x = (int)Math.Round((p.X * c - p.Z * s - gx) / step), z = (int)Math.Round((p.X * s + p.Z * c - gz) / step); return x < 0 || x >= width || z < 0 || z >= height ? -1 : z * width + x; }
        Vector3 Point(int cell) { double x = gx + cell % width * step, z = gz + cell / width * step, c = Math.Cos(h.Yaw), s = Math.Sin(h.Yaw); return new Vector3(h.Origin.X + (float)(x * c + z * s), from.Y, h.Origin.Z + (float)(-x * s + z * c)); }
        int start = Cell(from), end = Cell(to);
        if (start < 0 || end < 0) return result;
        int generation = ++h.GridGeneration; var queue = h.GridQueue; queue.Clear();
        h.GridVisited[start] = generation; h.GridDistance[start] = 0; h.GridPrevious[start] = -1; queue.Enqueue(start, 0);
        int visits = 0;
        while (queue.TryDequeue(out int at, out _) && visits++ < 20000)
        {
            if (at == end)
            {
                for (int p = end; p != start && p >= 0; p = h.GridPrevious[p]) result.Add(Point(p));
                result.Reverse(); result.Add(to);
                // Remove needless cell steps, retaining only straight, verified segments.
                var anchor = from; int i = 0;
                while (i < result.Count) { int last = i; while (last + 1 < result.Count && FreeSegment(h, anchor, result[last + 1])) last++; if (last > i) result.RemoveRange(i, last - i); anchor = result[i++]; }
                return result;
            }
            int ax = at % width, az = at / width;
            for (int dz = -1; dz <= 1; dz++) for (int dx = -1; dx <= 1; dx++)
            {
                if (dx == 0 && dz == 0) continue;
                int x = ax + dx, z = az + dz; if (x < 0 || x >= width || z < 0 || z >= height || h.GridRows[z][x] != '1') continue;
                if (dx != 0 && dz != 0 && (h.GridRows[az][x] != '1' || h.GridRows[z][ax] != '1')) continue;
                int next = z * width + x; float distance = h.GridDistance[at] + (dx != 0 && dz != 0 ? 1.414214f : 1);
                if (h.GridVisited[next] == generation && h.GridDistance[next] <= distance) continue;
                h.GridVisited[next] = generation; h.GridDistance[next] = distance; h.GridPrevious[next] = at;
                queue.Enqueue(next, distance + MathF.Sqrt((x - end % width) * (x - end % width) + (z - end / width) * (z - end / width)));
            }
        }
        return result;
    }
    private static Vector3 OpenCeremonyPoint(Hall h, Vector3 point)
    {
        if (FreeSegment(h, point, point)) return point;
        for (float r = 0.15f; r <= 1.2f; r += 0.15f) for (int i = 0; i < 16; i++)
        {
            var p = point + new Vector3(MathF.Sin(i * MathF.PI / 8) * r, 0, MathF.Cos(i * MathF.PI / 8) * r);
            if (FreeSegment(h, p, p)) return p;
        }
        return point;
    }
    private void CeremonyEnter(Hall h, Figure f, bool appear)
    {
        f.Ceremony = CeremonyRole(f.Role); if (!f.Ceremony) return;
        f.Rest = f.Target; f.RestYaw = f.Group.Rotation.Y;
        // Browser landmarks.ts: first roster, priest's appear, upstairs or unseen from the square are already placed.
        if (appear || !EyeInside(h) || f.Target.Y - h.Origin.Y >= 2) return;
        var entry = DoorAt(h); var approach = f.Rest;
        if (f.Human.CanSit && f.Role is "guest" or "mourner" or "worshipper" or "widow") approach -= new Vector3(MathF.Sin(f.RestYaw), 0, MathF.Cos(f.RestYaw)) * 0.62f;
        entry = OpenCeremonyPoint(h, entry); approach = OpenCeremonyPoint(h, approach);
        f.CeremonyGoal = approach;
        var path = Route(h, entry, approach);

        if (path.Count == 0) return;
        f.Group.Position = entry; f.Path.Clear(); foreach (var p in path) f.Path.Enqueue(p);
        f.Target = f.Path.Dequeue(); f.Moving = true; f.Human.Root.Position = Vector3.Zero; f.Human.Play("walk");
    }
    private void CeremonyLeave(Hall h, Figure f)
    {
        f.Leaving = true; f.Loop.Clear(); f.Path.Clear(); f.Human.Root.Position = Vector3.Zero;
        if (!EyeInside(h) && h.Id == "cathedral" && EventRoleForWalk(f.Role))
        {
            int n = 0; foreach (var other in h.Figures.Values) if (other.Leaving) n++;
            if (f.Role.StartsWith("bearer") && int.TryParse(f.Role.AsSpan(6), out int bearer))
                f.Group.Position = h.Origin + new Vector3(bearer % 2 == 0 ? -.4f : .4f, 0, 8.4f + (bearer >= 2 ? 1.3f : 0));
            else f.Group.Position = h.Origin + new Vector3(n % 2 == 0 ? 0.7f : -0.7f, 0, 11.6f + n / 2 * 0.9f);
        }
        if (f.Human.CanSit && f.Role is "guest" or "mourner" or "worshipper" or "widow") f.Group.Position -= new Vector3(MathF.Sin(f.RestYaw), 0, MathF.Cos(f.RestYaw)) * 0.62f;
        f.Group.Position = OpenCeremonyPoint(h, f.Group.Position);
        f.CeremonyGoal = OpenCeremonyPoint(h, DoorAt(h));
        var path = Route(h, f.Group.Position, f.CeremonyGoal);
        foreach (var p in path) f.Path.Enqueue(p);
        if (f.Path.Count > 0) { f.Target = f.Path.Dequeue(); f.Moving = true; f.Human.Play("walk"); }
        else f.Moving = false;
    }
    private bool CeremonyStep(Hall h, Figure f, double delta, bool near)
    {
        if (!f.Ceremony || !f.Moving && !f.Leaving) return false;
        f.Group.Visible = near;
        if (Actors.I?.NpcOwned(f.Id) == false) return true;
        if (f.Leaving && !f.Moving) { FinishExit(h, f); return true; }
        if (!near) return true;
        var from = f.Group.Position;
        var eye = Main.I.Cam.GlobalPosition;
        double hurry = EventRoleForWalk(f.Role) && new Vector2(eye.X - from.X, eye.Z - from.Z).Length() > 20 ? 2.4 : 1;
        var to = from.MoveToward(f.Target, (float)(f.Speed * (f.Leaving ? 1.1 : 1) * hurry * Math.Min(delta, 0.1)));
        if (FreeSegment(h, from, to))
        {
            f.Group.Position = to; f.Group.Rotation = new Vector3(0, MathF.Atan2(f.Target.X - from.X, f.Target.Z - from.Z), 0);
            if (to.DistanceTo(f.Target) < 0.05)
            {
                if (f.Path.Count > 0) f.Target = f.Path.Dequeue();
                else { f.Moving = false; if (f.Leaving) FinishExit(h, f); else { f.Group.Position = f.Rest; f.Group.Rotation = new Vector3(0, f.RestYaw, 0); f.Human.Play(f.Motion); CeremonyEntered++; } }
            }
        }
        else { f.Wait += delta; if (f.Wait > 3) { f.Wait = 0; var path = Route(h, OpenCeremonyPoint(h, from), f.CeremonyGoal); f.Path.Clear(); foreach (var point in path) f.Path.Enqueue(point); if (f.Path.Count > 0) f.Target = f.Path.Dequeue(); } }
        f.Human.Root.Position = new Vector3(0, f.Moving ? f.Human.Bob() : f.RestLift + f.Human.MotionLift(), 0); f.Human.Update((float)Math.Min(delta, 0.1));
        if (f.EventWear != null) LeadLooks.Grip(f.EventWear, EventRole(f.Role)); return true;
    }
    private void FinishExit(Hall h, Figure f)
    {
        var door = DoorAt(h); var s = town?.ActionPerson(f.Id);
        if (s != null) { s.X = door.X; s.Z = door.Z; town!.ActionOutside(s); }
        CeremonyExited++; ceremonyGone.Add(f.Id);
    }

    // landmarks.ts FUNERAL_MARKS. The ordinary hall plans stay the source of seats and walls.
    private static readonly JsonDocument funeralMarks = JsonDocument.Parse("""
    {"requiemPriest":{"x":0,"z":35.5,"yaw":3.141592653589793},"bearer0":{"x":-0.42,"z":31.85,"yaw":0},"bearer1":{"x":0.42,"z":31.85,"yaw":0},"bearer2":{"x":-0.42,"z":30.7,"yaw":0},"bearer3":{"x":0.42,"z":30.7,"yaw":0}}
    """);
    private Node3D? bier;
    private static bool EventMark(Hall h, string name, out JsonElement mark) => h.Plan.GetProperty("marks").TryGetProperty(name, out mark) || h.Id == "cathedral" && funeralMarks.RootElement.TryGetProperty(name, out mark);
    private static string? EventRole(string role) => role switch { "groom" => "groom", "bride" => "bride", "wedding_priest" or "requiem_priest" => "priest", "widow" => "widow", "bearer0" or "bearer1" or "bearer2" or "bearer3" => "bearers", _ => null };
    private static void EventDress(Figure f)
    {
        string? role = EventRole(f.Role); if (role == null) return;
        f.EventWear = LeadLooks.Make(role); f.Group.AddChild(f.EventWear); ((LeadWear)f.EventWear).Bind(f.Human);
    }
    private void EventRoster(Hall h, JsonElement reply)
    {
        if (h.Id != "cathedral") return;
        bool funeral = reply.TryGetProperty("funeral", out var f) && f.ValueKind == JsonValueKind.Object;
        if (!funeral) { bier?.QueueFree(); bier = null; return; }
        if (bier != null) return;
        bier = new Node3D { Name = "requiem_bier", Position = h.Origin + new Vector3(0, 0, 33.6f) }; Main.I.View.AddChild(bier);
        EventProps.Box(bier, new Vector3(0.85f, 0.12f, 2.3f), new Vector3(0, 0.76f, 0), 0x141214);
        foreach (float x in new[] { -0.34f, 0.34f }) foreach (float z in new[] { -0.85f, 0.85f }) EventProps.Box(bier, new Vector3(0.09f, 0.7f, 0.09f), new Vector3(x, 0.35f, z), 0x211914);
        var coffin = LeadLooks.Coffin(); coffin.Position = new Vector3(0, 0.83f, 0); bier.AddChild(coffin);
    }
}

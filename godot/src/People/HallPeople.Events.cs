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
    // (#192: the cathedral's organist climbs to his loft, the confessor walks to his box and steps in)
    private static bool CeremonyRole(string role) => role is "organist" or "confessor" or "audience" or "prompter" or "requiem_priest" or "bearer0" or "bearer1" or "bearer2" or "bearer3" or "widow" or "mourner" or "groom" or "bride" or "guest" or "wedding_priest" or "worshipper" or "faithful" or "preacher" or "c_guest" or "c_groom" or "c_bride";
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
        // Browser landmarks.ts: first roster, priest's appear, or unseen from the square are already placed; upstairs too,
        // unless the hall's plan has a stair up there (#186: the Vleeshuis's theatre audience climbs its stair).
        bool upstairs = f.Target.Y - h.Origin.Y >= 2;
        if (appear || !EyeInside(h) || upstairs && StairRoute(h, DoorAt(h), f.Rest) == null) return;
        var entry = DoorAt(h); var approach = f.Rest;
        if (f.Human.CanSit && f.Role is "guest" or "mourner" or "worshipper" or "widow") approach -= new Vector3(MathF.Sin(f.RestYaw), 0, MathF.Cos(f.RestYaw)) * 0.62f;
        entry = OpenCeremonyPoint(h, entry); approach = OpenCeremonyPoint(h, approach);
        f.CeremonyGoal = approach;
        var path = upstairs ? StairRoute(h, entry, approach)! : Route(h, entry, approach);
        f.StairWay = upstairs;

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
        f.StairWay = f.Group.Position.Y - h.Origin.Y >= 2;
        var path = f.StairWay ? StairRoute(h, f.Group.Position, f.CeremonyGoal) ?? new List<Vector3>() : Route(h, f.Group.Position, f.CeremonyGoal);
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
        if (f.StairWay || FreeSegment(h, from, to))
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
    /// <summary>
    /// A way between the hall's ground floor and a place on an upper floor by the plan's stair (#186): the ground floor's own
    /// route to the stair's foot, up the middle of the flight, a step on at its head, then the upper floor's route (or
    /// straight, where the plan has none) to the place. Either end may be the high one. Null when no stair reaches it.
    /// </summary>
    private static List<Vector3>? StairRoute(Hall h, Vector3 from, Vector3 to)
    {
        bool down = from.Y > to.Y; var low = down ? to : from; var high = down ? from : to;
        if (!h.Plan.TryGetProperty("stairs", out var stairs)) return null;
        double c = h.Cos, s = h.Sin;
        Vector3 W(double x, double y, double z) => new(h.Origin.X + (float)(x * c + z * s), h.Origin.Y + (float)y, h.Origin.Z + (float)(-x * s + z * c));
        foreach (var st in stairs.EnumerateArray())
        {
            double y0 = st.GetProperty("y0").GetDouble(), y1 = st.GetProperty("y1").GetDouble();
            if (Math.Abs(y0 - (low.Y - h.Origin.Y)) > 0.5 || Math.Abs(y1 - (high.Y - h.Origin.Y)) > 0.8) continue;
            var r = st.GetProperty("rect"); bool alongX = st.GetProperty("along").GetString() == "x";
            double foot = st.GetProperty("foot").GetDouble(), headAt = st.GetProperty("head").GetDouble(), dir = Math.Sign(headAt - foot);
            double mid = alongX ? (r.GetProperty("minZ").GetDouble() + r.GetProperty("maxZ").GetDouble()) / 2 : (r.GetProperty("minX").GetDouble() + r.GetProperty("maxX").GetDouble()) / 2;
            Vector3 At(double along, double y) => alongX ? W(along, y, mid) : W(mid, y, along);
            var before = At(foot - dir * 0.7, y0); var start = At(foot, y0); var end = At(headAt, y1); var after = At(headAt + dir * 0.7, y1);
            var groundLeg = new List<Vector3>(Route(h, low, before)); if (groundLeg.Count == 0 && !FreeSegment(h, low, before)) groundLeg = LevelRoute(h, low, before);
            if (groundLeg.Count == 0) { StairNote += $" no ground way from {low} to {before};"; continue; }
            var upperLeg = new List<Vector3>(Route(h, after, high)); if (upperLeg.Count == 0 && !FreeSegment(h, after, high)) upperLeg = LevelRoute(h, after, high);
            if (upperLeg.Count == 0) upperLeg.Add(high);
            var way = new List<Vector3>(groundLeg) { before, start, end, after }; way.AddRange(upperLeg);
            if (!down) return way;
            // coming down: the same way back from the high place to the low one
            way.Reverse(); way.RemoveAt(0); way.Add(low); return way;
        }
        return null;
    }
    /// <summary>For the checks (#186): a hall's door, and how many points its stair way between two places has (-1: none).</summary>
    public static string StairNote = "";
    /// <summary>
    /// A way across one floor of a hall where the plan's route nodes give none (#186: the Vleeshuis's ground floor has no node
    /// near its stair's foot): half-metre cells of the plan's own floors and solids at that height, searched breadth first,
    /// then pulled straight wherever the plan lets a straight walk through. A floor here counts to its edge (FreeSegment keeps
    /// 0.3 m in from every floor's edge, which leaves no way from the Vleeshuis's porch through its doorway into the hall);
    /// solids keep their 0.3 m. Empty when the floor does not join the two.
    /// </summary>
    private static List<Vector3> LevelRoute(Hall h, Vector3 from, Vector3 to)
    {
        const float step = 0.5f; var result = new List<Vector3>();
        Parse(h);
        bool FreeSegment(Hall hall, Vector3 a0, Vector3 b0)
        {
            if (Math.Abs(a0.Y - b0.Y) > 0.4) return false;
            int n = Math.Max(1, (int)Math.Ceiling(a0.DistanceTo(b0) / 0.05));
            for (int i = 1; i <= n; i++)
            {
                var p = a0.Lerp(b0, (float)i / n) - hall.Origin; double x = p.X * hall.Cos - p.Z * hall.Sin, z = p.X * hall.Sin + p.Z * hall.Cos; bool onFloor = false;
                foreach (var (y, floors, solids) in hall.Levels)
                {
                    if (Math.Abs(y - p.Y) >= 0.4) continue;
                    for (int k = 0; k < floors.Length; k += 4) if (InRect(floors, k, x, z, 0)) onFloor = true;
                    for (int k = 0; k < solids.Length; k += 4) if (InRect(solids, k, x, z, 0.3)) return false;
                }
                if (!onFloor) return false;
            }
            return true;
        }
        double c = h.Cos, s = h.Sin; float y = from.Y;
        Vector3 W(double x, double z) => new(h.Origin.X + (float)(x * c + z * s), y, h.Origin.Z + (float)(-x * s + z * c));
        (double x, double z) L(Vector3 p) { var d = p - h.Origin; return (d.X * c - d.Z * s, d.X * s + d.Z * c); }
        var a = L(from); var b = L(to);
        double x0 = Math.Min(a.x, b.x) - 30, x1 = Math.Max(a.x, b.x) + 30, z0 = Math.Min(a.z, b.z) - 30, z1 = Math.Max(a.z, b.z) + 30;
        int nx = (int)((x1 - x0) / step) + 1, nz = (int)((z1 - z0) / step) + 1;
        if (nx * nz > 40000) return result;
        int Cell(double x, double z) => (int)Math.Round((x - x0) / step) + (int)Math.Round((z - z0) / step) * nx;
        Vector3 At(int i) => W(x0 + i % nx * step, z0 + i / nx * step);
        var free = new sbyte[nx * nz]; bool Free(int i) { if (free[i] == 0) free[i] = (sbyte)(FreeSegment(h, At(i), At(i)) ? 1 : -1); return free[i] > 0; }
        int start = Cell(a.x, a.z), goal = Cell(b.x, b.z); var previous = new int[nx * nz]; Array.Fill(previous, -1); previous[start] = start;
        var queue = new Queue<int>(); queue.Enqueue(start);
        while (queue.Count > 0 && previous[goal] < 0)
        {
            int i = queue.Dequeue(), ix = i % nx, iz = i / nx;
            for (int dz = -1; dz <= 1; dz++) for (int dx = -1; dx <= 1; dx++)
            {
                int jx = ix + dx, jz = iz + dz; if ((dx | dz) == 0 || jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
                int j = jz * nx + jx; if (previous[j] >= 0 || !(j == goal || Free(j)) || !FreeSegment(h, i == start ? from : At(i), j == goal ? to : At(j))) continue;
                previous[j] = i; queue.Enqueue(j);
            }
        }
        if (previous[goal] < 0) return result;
        var cells = new List<Vector3>(); for (int i = goal; i != start; i = previous[i]) cells.Add(i == goal ? to : At(i)); cells.Reverse();
        // pulled straight: from each corner on to the furthest one in a free straight line
        var here = from;
        for (int k = 0; k < cells.Count;)
        {
            int far = k; for (int m = cells.Count - 1; m > k; m--) if (FreeSegment(h, here, cells[m])) { far = m; break; }
            result.Add(cells[far]); here = cells[far]; k = far + 1;
        }
        return result;
    }
    /// <summary>For the checks (#192): a role's walk in from the hall's door to its place: the way's points (by the stair when it
    /// is upstairs; -1 none) and the last step from the way's end onto the place itself (into a box, onto a seat).</summary>
    public (int Points, float StepIn) WalkIn(string id, string role)
    {
        foreach (var h in Halls)
        {
            if (h.Id != id || !h.Roles.TryGetProperty(role, out var spec) || !spec.TryGetProperty("at", out var at) || !EventMark(h, at.GetString()!, out var mark)) continue;
            var rest = World(h, mark); var entry = OpenCeremonyPoint(h, DoorAt(h));
            if (rest.Y - h.Origin.Y >= 2) return (StairRoute(h, entry, rest)?.Count ?? -1, 0);
            var approach = OpenCeremonyPoint(h, rest); var way = Route(h, entry, approach);
            return (way.Count, new Vector2(rest.X - approach.X, rest.Z - approach.Z).Length());
        }
        return (-1, -1);
    }
    public Vector3? DoorOf(string id) { foreach (var h in Halls) if (h.Id == id) return DoorAt(h); return null; }
    public int StairWayLength(string id, Vector3 from, Vector3 to) { foreach (var h in Halls) if (h.Id == id) return StairRoute(h, from, to)?.Count ?? -1; return -1; }
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

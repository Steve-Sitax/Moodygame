using System;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>World-space currents along the authored channel and through a room's open portals.</summary>
public sealed class RuienWaterFlow
{
    private readonly RuienData.WaterSheet sheet;
    private readonly float[] stations;
    public bool Varying => sheet.FlowGuide.Length >= 2 && sheet.FlowEnds.HasValue || sheet.FlowTargets.Length > 0;

    public RuienWaterFlow(RuienData.WaterSheet sheet)
    {
        this.sheet = sheet;
        stations = new float[sheet.FlowGuide.Length];
        for (int i = 1; i < stations.Length; i++)
            stations[i] = stations[i - 1] + sheet.FlowGuide[i - 1].DistanceTo(sheet.FlowGuide[i]);
    }

    public Vector2 At(Vector2 point)
    {
        if (sheet.FlowGuide.Length >= 2 && sheet.FlowEnds is Vector2 ends)
        {
            var path = sheet.FlowGuide;
            float nearest = float.MaxValue, station = 0;
            Vector2 direction = Vector2.Zero;
            for (int i = 0; i + 1 < path.Length; i++)
            {
                var span = path[i + 1] - path[i];
                float squared = span.LengthSquared();
                if (squared < 1e-10f) continue;
                float fraction = Math.Clamp((point - path[i]).Dot(span) / squared, 0, 1);
                float distance = point.DistanceSquaredTo(path[i] + span * fraction);
                if (distance >= nearest) continue;
                nearest = distance;
                station = Mathf.Lerp(stations[i], stations[i + 1], fraction);
                var start = (path[Math.Min(i + 1, path.Length - 1)] - path[Math.Max(i - 1, 0)]).Normalized();
                var end = (path[Math.Min(i + 2, path.Length - 1)] - path[i]).Normalized();
                direction = start.Lerp(end, fraction).Normalized();
            }
            // Distance to an outlet via either end. Equal costs form a gentle
            // divide in a loop; neither side is forced to run against its outlet.
            float towardStart = ends.X + station;
            float towardEnd = ends.Y + stations[^1] - station;
            return direction * (sheet.FlowSpeed * Math.Clamp((towardStart - towardEnd) / 1.0f, -1, 1));
        }
        if (sheet.FlowTargets.Length > 0)
        {
            float best = float.MaxValue;
            Vector2 target = point;
            foreach (var portal in sheet.FlowTargets)
            {
                var location = new Vector2(portal.X, portal.Y);
                float cost = point.DistanceTo(location) + portal.Z;
                if (cost >= best) continue;
                best = cost;
                target = location;
            }
            return (target - point).Normalized() * sheet.FlowSpeed;
        }
        return sheet.Flow;
    }
}

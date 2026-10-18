using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Movers;
using Scheldemist.Play;

namespace Scheldemist.Player;

/// <summary>
/// Issue 154 (`--moveonly crews`, `--crewhour 19.5` for dusk): every boat underway near the town has her people aboard;
/// pictures from the deck of a ship underway toward her steersman, and of a rowing boat with her rower.
/// </summary>
public partial class MoveTest
{
    private async Task CrewCheck()
    {
        var j = Jef.I;
        double hour = double.TryParse(Main.I.Arg("crewhour"), NumberStyles.Float, CultureInfo.InvariantCulture, out double h) ? h : 13;
        await Tidy(hour);
        // let the river's traffic come in out of the fog
        var seen = new Dictionary<string, (int Underway, int Manned)>();
        var empty = new List<object>();
        for (int k = 0; k < 9; k++)
        {
            await Frames(240);
            if (BoatCrews.I == null) break;
            foreach (var r in BoatCrews.I.Report())
            {
                if (!r.Underway || new Vector2(r.At.X - j.X, r.At.Z - j.Z).Length() > 140) continue;
                var s = seen.GetValueOrDefault(r.Kind);
                seen[r.Kind] = (s.Underway + 1, s.Manned + (r.Hands > 0 && r.Drawn ? 1 : 0));
                if (r.Hands == 0 || !r.Drawn) empty.Add(new { r.Kind, at = new[] { R(r.At.X), R(r.At.Z) }, r.Hands, r.Drawn });
            }
            // follow the traffic: Jef stands where most of it passes (the Rijnkaai's edge, then the Werf)
            if (k == 3) j.Place(-60, 0.5f, MathF.PI, 0, 0);
        }
        reports.Add(new { crews = seen.Select(kv => new { kind = kv.Key, samples = kv.Value.Underway, manned = kv.Value.Manned }).ToArray(), empty = empty.Take(20).ToArray(), aboard = BoatCrews.I?.Aboard });
        Check(seen.Count > 0 && empty.Count == 0, $"every boat underway within 140 m has her people aboard ({hour:0.#}h)", new { kinds = seen.Count, empty = empty.Count });
        // pictures: from the deck of the nearest big boat underway, toward her steersman; and the nearest rowing boat
        var manned = (BoatCrews.I?.Report() ?? Enumerable.Empty<(string Kind, Vector3 At, bool Underway, int Hands, bool Drawn)>()).Where(r => r.Underway && r.Hands > 0).OrderBy(r => new Vector2(r.At.X - j.X, r.At.Z - j.Z).Length()).ToList();
        foreach (var r in manned.Where(r => Boats.I.Dims(r.Kind).Length >= 9).Take(2).Concat(manned.Where(r => Boats.I.Dims(r.Kind).Length < 9).Take(1)))
        {
            var deck = ShipWalk.I.Decks.FirstOrDefault(d => d.Visible() && d.Kind == r.Kind && new Vector2(d.World().Origin.X - r.At.X, d.World().Origin.Z - r.At.Z).Length() < 1);
            if (deck == null) continue;
            var dim = Boats.I.Dims(r.Kind);
            // from her bow (a rowing boat's too), toward her stern: the steersman, or the rower at his oars
            var bow = deck.Mesh.Nearest(new Vector2(deck.Small ? 0 : dim.Beam * 0.3f, dim.Length / 2 - (deck.Small ? 0.6f : Math.Min(4, dim.Length * 0.2f))));
            ShipWalk.I.Attach(deck, bow);
            await Frames(5);
            var stern = deck.At(deck.Mesh.Nearest(new Vector2(0, -dim.Length / 2 + Math.Min(2.2f, dim.Length * 0.12f)))) + Vector3.Up * 0.9f;
            var me = deck.At(bow);
            j.Yaw = Facing(stern.X - me.X, stern.Z - me.Z);
            j.Pitch = deck.Small ? -0.35f : MathF.Atan2(stern.Y - me.Y - Jef.Eye, new Vector2(stern.X - me.X, stern.Z - me.Z).Length());
            await Shot($"crew-{hour:0.#}h-{r.Kind}-deck", 12);
            ShipWalk.I.Clear();
        }
    }
}

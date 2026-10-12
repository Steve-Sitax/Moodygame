using System;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>The development clock controls change the same authoritative state as normal play.</summary>
public sealed class NativeDev : INativeServiceModule
{
    public void Register(NativeServiceHost host)
    {
        host.Register("POST", "/api/dev/set", r => {
            if (r.PlayerId != 1) throw new NativeServiceException("only the host changes the clock", 403);
            foreach (string field in new[] { "day", "hour", "minute", "food", "warmth", "health", "sleep", "money_c" })
                if (r.Body[field] is JsonValue value && value.TryGetValue<double>(out double number) && double.IsFinite(number))
                    host.Context.Execute("UPDATE player SET " + field + "=$p0 WHERE id=1", Math.Floor(number + .5));
            string weather = r.Text("weather");
            if (weather is "fog" or "mist" or "clear" or "rain" or "storm")
            {
                var clock = host.Clock.View();
                host.Clock.SetWeather(weather, r.Bool("weather_turn") ? NativeCoreClock.Number(clock, "hour") + NativeCoreClock.Number(clock, "minute") / 60.0 : null);
            }
            host.Clock.ResetLimits(); foreach (var hook in host.TickAfterHooks) hook(r); host.PublishState(); return host.Payload(1);
        });
        host.Register("POST", "/api/dev/advance", r => {
            if (r.PlayerId != 1) throw new NativeServiceException("only the host changes the clock", 403);
            if (host.Context.PlayerState(1, "ending") != null) throw new NativeServiceException("the week is over", 409);
            double number = NativeTown.N(r.Body["minutes"]);
            int minutes = (int)Math.Clamp(Math.Floor(number + .5), 0, 1440);
            var turn = host.Clock.PassTime(1, minutes);
            host.Clock.ResetLimits(); foreach (var hook in host.TickAfterHooks) hook(r); host.PublishState();
            return NativeCoreClock.Join(turn, host.Payload(1));
        });
    }
}

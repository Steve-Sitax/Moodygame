using System;
using System.Linq;
using System.Threading.Tasks;
using Godot;

namespace Scheldemist.Play;

internal partial class MarketProof
{
    /// <summary>`carthome` (#198, `--market-place`, the Vismarkt by default): a seller whose next stop after the market has no
    /// place for her cart (a storm's shelter, a tavern) used to leave it at her stall for good. At 10:00, with her cart parked at
    /// her pitch, she is sent to a tavern: she must push the cart home first (a handcart trip to its home place, then on foot to
    /// the tavern), and the cart must stand at home afterwards, drawn there and not at the pitch.</summary>
    private async Task CartHome()
    {
        string place = Main.I.Arg("market-place") is { Length: > 0 } mp ? mp : "vismarkt";
        string prefix = place == "vismarkt" ? People.NativeMarket.SellerPrefix : "gm_seller_";
        await Dev.Kit.I.Light(10, "clear", day: 1);
        town.Refill();
        await Frames(240);
        var api = Net.ServerLink.I!.Api!;
        var transport = await api.TownTransport();
        var journeys = ResidentJourneys.I ?? throw new InvalidOperationException("no resident journeys");
        // (the carts' places as the clock now has them: the jump to 10:00 is not walked)
        await journeys.LoadTransport();
        await Frames(30);
        var seller = town.Data!.Residents.Where(r => r.Id.StartsWith(prefix, StringComparison.Ordinal)).Select(r => (r, s: town.ActionPerson(r.Id), cart: transport.Vehicles.FirstOrDefault(v => v.Kind == "handcart" && v.Owner == r.Id)))
            .FirstOrDefault(c => c.s != null && c.cart != null && !journeys.Trips.Any(t => t.Person == c.s) && journeys.CartPlace(c.cart.Id).StartsWith("work", StringComparison.Ordinal));
        Check("a seller stands at her stall at 10:00 with her cart parked at her pitch", seller.s != null,
            transport.Vehicles.Where(v => v.Kind == "handcart" && v.Owner.StartsWith(prefix, StringComparison.Ordinal)).Select(v => v.Id + " " + v.At + " " + journeys.CartPlace(v.Id)).Take(6).ToArray());
        if (seller.s == null) return;
        var s = seller.s; var cart = seller.cart!;
        string from = journeys.CartPlace(cart.Id);
        string previous = s.Key;
        s.Key = "tavern:ankere";
        bool began = journeys.BeginFor(s, previous);
        var trip = journeys.Trips.FirstOrDefault(t => t.Person == s);
        Check("sent from the market to a tavern (no place for her cart there), she takes her handcart home first", began && trip is { Mode: "handcart", CartKey: "home" }, new { previous, from, trip = trip == null ? null : new { trip.Mode, trip.CartKey, trip.Why, park = trip.Park } });
        Game.GameState.I.PlayingWhen = () => true;
        for (int i = 0; i < 60 * 300 && journeys.Trips.Contains(trip!) && trip!.Phase is "fetch" or "go"; i++) await Frame();
        string after = journeys.CartPlace(cart.Id);
        var home = cart.Parks.TryGetValue("home", out var hp) ? hp : cart.Home;
        Game.GameState.I.PlayingWhen = () => false;
        facts["cartHome"] = new { seller = s.R.Id, cart = cart.Id, from, after, phase = trip?.Phase, ended = trip?.Ended, home, at = new[] { Math.Round(s.X, 1), Math.Round(s.Z, 1) } };
        Check("her cart stands at home after the trip, not at her stall", after == "home" && (trip == null || !journeys.Trips.Contains(trip) || trip.Phase is not ("fetch" or "go")), facts["cartHome"]);
        await Dev.Kit.I.Light(13, "clear", day: 1);
    }
}

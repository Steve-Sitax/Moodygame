using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Game;
using Scheldemist.Player;
using Scheldemist.Talks;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.Audio;

/// <summary>
/// What ties the sound to the rest of the game (the browser's main.ts did this): the clock and the weather from the
/// game's state, the rain from the daylight, Jef's steps, the townspeople near him, the bubbles' voices, the dice.
/// Options hold their own: with --hour or --weather the state's clock or weather is not taken.
/// </summary>
public partial class Soundscape
{
    private bool wiredJef, wiredBubbles, wiredDice, wiredState;
    private Jef? walking;
    private Action<bool>? onStep;
    private Action? onLand, onSplash;
    private GameState? state;
    private readonly List<(Transform3D inverse, Aabb box, string kind)> rooms = new();
    /// <summary>The rooms' part may supply its exact threshold and floor instead of the baked lining.</summary>
    public Func<Vector3, string?>? InteriorAt { get; set; }
    public Func<Vector3, string>? SurfaceAt { get; set; }
    public Func<Vector3, double>? PuddleAt { get; set; }
    /// <summary>The great storm's event and wind parts supply these when ported; an ordinary storm day is not a tempest.</summary>
    public Func<(double level, double gust, double shelter)>? TempestNow { get; set; }
    private double nextWire, nextState;
    private Townspeople? townspeople;
    private readonly List<Vector2> around = new();
    private bool ownHour, ownWeather, ownRain;

    /// <summary>Once a second until every part is there: the hooks the other parts hold out.</summary>
    private void Wire()
    {
        if (now < nextWire) return;
        using var pollCost = Dev.FrameCost.Track("Sound.WirePoll");
        nextWire = now + 1;
        WireParts();
    }

    // The Jef event handlers capture locals. Enter their method only on the existing
    // one-second retry, so their display class is not allocated by every sound frame.
    private void WireParts()
    {
        if (!wiredState)
        {
            wiredState = true;
            state = GameState.I;
            state.ClockChanged += StateClock;
            state.WeatherChanged += StateWeather;
            StateClock();
            StateWeather(state.Weather);
        }
        if (!wiredJef && Jef.I is { } jef && IsInstanceValid(jef))
        {
            wiredJef = true;
            walking = jef;
            onStep = hurry => PlayerStep(jef, hurry);
            onLand = () => PlayerStep(jef, true);
            onSplash = () => Play("splash", new Vector3(jef.X, (float)Water.Level(jef.X, jef.Z), jef.Z));
            jef.Stepped += onStep;
            jef.Landed += onLand;
            jef.Splashed += onSplash;
            jef.Stroke += SwimStroke;
        }
        if (!wiredBubbles && Bubbles.I is { } bubbles)
        {
            wiredBubbles = true;
            bubbles.Speak ??= (at, sex, age, seconds) => Speech(at.X, at.Z, new VoiceOf(sex, age), seconds);
        }
        if (!wiredDice && Dice.I is { } dice)
        {
            wiredDice = true;
            dice.Sfx ??= name => Play(name);
        }
        townspeople ??= Main.I.GetNodeOrNull<Townspeople>("Townspeople");
    }

    private void CacheBakedRooms()
    {
        foreach (var node in BakedWorld.All(Main.I.World))
            if (node is MeshInstance3D { Mesh: not null } mesh && mesh.Name.ToString().StartsWith("house_lining_"))
            {
                string id = mesh.Name.ToString()[13..];
                // Godot replaces the colon in a glTF node's name with an underscore.
                string kind = id.StartsWith("tavern:") || id.StartsWith("tavern_") ? "tavern" : id.StartsWith("shop:") || id.StartsWith("shop_") ? "shop" : "home";
                rooms.Add((mesh.GlobalTransform.AffineInverse(), mesh.Mesh.GetAabb(), kind));
            }
    }

    private void StateClock()
    {
        if (!ownHour && test == null) SetClock(GameState.I.HourF);
    }
    private void StateWeather(string weather)
    {
        if (!ownWeather && test == null) SetWeather(weather);
    }

    // rijnkaai.ts surfaceAt: water below a stone bridge does not turn its paving into timber.
    private string PlayerSurface(Vector3 p)
    {
        if (SurfaceAt != null) return SurfaceAt(p);
        if (roomKind != null) return roomKind is "tavern" or "home" or "shop" ? "wood" : "stone";
        return TimberAt(p.X, p.Z) ? "wood" : "stone";
    }
    private static bool TimberAt(float x, float z) =>
        (x > 5.4f && x < 8.6f && z < -1) ||
        (x > -251 && x < -247 && z > -58 && z < 0) ||
        (x > -51 && x < -29 && z > -11.4f && z < -3) ||
        (Math.Abs(x + 42) < 0.45f && z > -3.2f && z < 0.3f);

    private void PlayerStep(Jef jef, bool hurry)
    {
        var p = new Vector3(jef.X, jef.Y, jef.Z);
        string surface = PlayerSurface(p);
        Action play = () => Footstep(surface, hurry, surface == "stone" && roomKind == null ? PuddleAt?.Invoke(p) ?? Puddles.At(p.X,p.Z,Daylight.I?.Puddle ?? 0) : 0);
        if (roomKind != null) Indoors(play);
        else play();
    }

    private string? BakedInterior(Vector3 p)
    {
        foreach (var room in rooms)
        {
            Vector3 local = room.inverse * p;
            var a = room.box.Position;
            var b = room.box.End;
            if (local.X > a.X + 0.2f && local.X < b.X - 0.2f && local.Z > a.Z + 0.2f && local.Z < b.Z - 0.2f && local.Y >= a.Y - 0.2f && local.Y < b.Y - 0.2f) return room.kind;
        }
        // The large halls have no house lining. A roof above Jef identifies their baked shell.
        if (Solid.I == null || !IsInstanceValid(Solid.I)) return null;
        string roof = Solid.I.NameAt(p + Vector3.Up * 1.8f, p + Vector3.Up * 40);
        if (roof.Contains("cathedral") || roof.Contains("carolus") || roof.Contains("church")) return "church";
        if (roof.Contains("townhall")) return "hall";
        if (roof.Contains("steen")) return "museum";
        return null;
    }

    private void Unwire()
    {
        if (state != null && IsInstanceValid(state))
        {
            state.ClockChanged -= StateClock;
            state.WeatherChanged -= StateWeather;
        }
        if (walking != null && IsInstanceValid(walking))
        {
            walking.Stepped -= onStep;
            walking.Landed -= onLand;
            walking.Splashed -= onSplash;
            walking.Stroke -= SwimStroke;
        }
    }

    /// <summary>Four times a second: the clock, the weather and the rain as the game has them; the people out in the street.</summary>
    private void FollowState()
    {
        if (now < nextState) return;
        using var pollCost = Dev.FrameCost.Track("Sound.StatePoll");
        nextState = now + 0.25;
        FollowVolumes();
        if (test != null) return;
        var s = GameState.I;
        if (s is { Live: true })
        {
            if (!ownHour) SetClock(s.HourF);
            if (!ownWeather) SetWeather(s.Weather);
        }
        if (!ownRain && Daylight.I != null) SetRain(Daylight.I.Rain);
        if (walking != null && IsInstanceValid(walking))
        {
            var p = new Vector3(walking.X, walking.Y, walking.Z);
            SetInterior(InteriorAt != null ? InteriorAt(p) : BakedInterior(p));
        }
        if (TempestNow != null)
        {
            var storm = TempestNow();
            SetTempest(storm.level, storm.gust, storm.shelter);
        }
        if (townspeople != null)
        {
            around.Clear();
            foreach (var p in townspeople.Sims)
                if (!p.Inside) around.Add(new Vector2((float)p.X, (float)p.Z));
            SetCrowdAround(around);
        }
    }

    private readonly Dictionary<string, double> wetLevels = new();
    private void FollowVolumes()
    {
        // the settings' levels are on the street's four buses: the room's four (and the organ's) follow them
        foreach (var (k, street, room) in VolumeBuses)
        {
            int from = busIndex[street], to = busIndex[room];
            float db = AudioServer.GetBusVolumeDb(from);
            bool mute = AudioServer.IsBusMute(from);
            double gain = mute ? 0 : Mathf.DbToLinear(db);
            wetLevels[street] = wetLevels[room] = gain;
            if (k == "ambience") wetLevels["Murmur"] = gain;
            if (Math.Abs(AudioServer.GetBusVolumeDb(to) - db) > 0.01f) AudioServer.SetBusVolumeDb(to, db);
            if (AudioServer.IsBusMute(to) != mute) AudioServer.SetBusMute(to, mute);
            if (k != "music") continue;
            int organ = busIndex["Organ"];
            if (Math.Abs(AudioServer.GetBusVolumeDb(organ) - db) > 0.01f) AudioServer.SetBusVolumeDb(organ, db);
            if (AudioServer.IsBusMute(organ) != mute) AudioServer.SetBusMute(organ, mute);
        }
    }

    private static readonly (string kind, string street, string room)[] VolumeBuses =
    {
        ("ambience", "Ambience", "RoomAmbience"), ("voices", "Voices", "RoomVoices"),
        ("music", "Music", "RoomMusic"), ("effects", "Effects", "RoomEffects"),
    };
}

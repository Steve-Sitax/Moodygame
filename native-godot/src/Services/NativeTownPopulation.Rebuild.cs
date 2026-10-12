using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativeTownPopulation
{
    /// <summary>Only after a new-game reset: replace generated residents, then run additions in source order.
    /// Ordinary launch and save load preserve existing people. The host installs native Ways before this runs.</summary>
    public JsonObject Rebuild(uint seed, string size = "normal")
    {
        if (C.Scalar<int>("SELECT COUNT(*) FROM npc_memory") > 0 || C.Scalar<int>("SELECT COUNT(*) FROM item") > 0 || C.Scalar<int>("SELECT COUNT(*) FROM home_lease WHERE ended IS NULL") > 0)
            throw new NativeServiceException("Start a new game before rebuilding the town's population.", 409);
        if (Facts["TOWN_SIZES"]?[size] == null) throw new NativeServiceException("town size is one of small, normal, large, very_large");
        var generated = Generate(seed, size); var people = generated["residents"]!.AsArray().Select(p => p!.DeepClone().AsObject()).ToArray(); generated.Remove("residents");
        C.Atomic(() => {
            C.Execute("CREATE TEMP TABLE native_population_old_ids(id TEXT PRIMARY KEY)"); C.Execute("INSERT INTO native_population_old_ids SELECT id FROM resident");
            C.Execute("DELETE FROM npc_relationship WHERE npc_id IN (SELECT id FROM native_population_old_ids)"); C.Execute("DELETE FROM resident"); C.Execute("DELETE FROM npc WHERE id IN (SELECT id FROM native_population_old_ids)"); C.Execute("DROP TABLE native_population_old_ids");
            // Imported state belongs to the preceding population. Its fixed room/model definitions remain assets;
            // the augmentation routines select homes, roles, doors and routes for the newly generated households.
            foreach (string key in new[] { "press", "homes", "poesje:door", "townlife_lamps", "townlife_lamps:topology", "lamps_help", "emigrants", "landmarks", "veloshop", "cartshop", "transport", "shops_m7", "mills", "prison", "stadspark-work-v1", "stadspark-dog-walkers-v1" }) C.Execute("DELETE FROM world_state WHERE key=$p0", key);
            C.SetWorld("town", generated); Town.Clear(); foreach (var person in people) AddResident(person);
            foreach (var addition in Augment) addition(seed); Town.Clear();
        });
        return Snapshot();
    }
}

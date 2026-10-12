# Native dedicated server audit

Read-only audit after the complete population proof; native multiplayer is not implemented by these notes.
The current native factory explicitly disables `MultiplayerAvailable` and returns an in-process backend.
Keep the existing server until native host/dedicated/guest/reconnect proofs pass.

Reuse Godot `Net/Api`, `MpSession`, `MpProtocol` (protocol 5, 20 Hz), `Together`, remote figures/gear and interpolation.
A native C# HTTP/WebSocket listener preserves those contracts without a browser or Node process. ENet requires
a wider client/protocol rewrite. Share one native service factory between in-game hosting and the dedicated app.

The following boundaries need implementation before that listener can be authoritative:

- Join/reconnect sessions, hashed player tokens, six online seats, host/admin checks, LAN discovery and version
  rejection remain original `server/src/mp` code. Native `Host.Call(...,playerId)` already separates players; derive
  that id from a verified session, never an arbitrary client id.
- `NativeBackendAdapter` currently translates names as player 1; `PublishState` emits a private player payload
  on a shared push event. Broadcast world pushes, but send player payloads/name translation only to their recipient.
  Population/new-week/save-load authorization checks host id, which must come from verified identity.
- `NativeCoreClock.Tick` advances the world and applies hourly needs to the caller only. Rest/collapse can advance
  the whole world for one player. Reuse original worldTick/online-player/all-asleep rules: one server clock, every
  online player's needs, individual sleep and only host Pause All. Generic pause holders currently let any caller
  stop the town; menu pauses must remain client-local while together.
- The original server assigns resident/extras/job-figure walkers and elects the moving-world PC. Port ownership,
  stale-state, pin and handover rules; otherwise clients independently move NPCs, cranes, boats and bridges.
  Native actions query current resident SQL; connect authenticated poses and walker ownership.
- Native factory callbacks capture one local Jef position. Replace them with fresh per-seat poses for park claims,
  work/actions, shelter and encounters. Preserve token-scoped money, pockets and relationships.

Town/navigation/population reuse constraints:

- Load one native scene plus saved district overlays, install support, then create services. Current backend boot
  waits on graphical Main.Loaded; dedicated boot needs scene/physics/data readiness without Jef, camera, HUD or
  menus. Full native nodes/mesh data work headless, but measure renderer/model load cost before stripping support.
- Build Ways once from the same authored ground/collision as clients. Stairs/ramparts retain quarter-metre heights;
  indoor multi-floor grids remain separate. Route batches run outside the host gate; live-body bitsets synchronize
  concurrent queries. Temporary bodies do not invalidate static routes; local crowds check live movement clearance.
- Generate households only on the authoritative host new week through the proved nineteen-stage lifecycle.
  Saves keep ids, memory and possessions. Guests consume server town/routes/rounds, never generate independently.
  Existing `mp_player` and player-scoped tables supply persistence.
- Check scene/version/layout fingerprints at join: object ids, lamp facts, routes, collision and heights must
  agree. Export/serve native packs and layouts, without the removed GLB/web bake.

Minimum proof: headless server plus two clients; shared clock/weather/lamps; separate profiles/jobs/pockets/trust;
hosted and dedicated joins; reconnect/stale walker/world handover; one sleeps while another works; host-only pause,
new week/load; authored lamp/prop agreement and elevated routes.

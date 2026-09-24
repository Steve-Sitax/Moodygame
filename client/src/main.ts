import * as THREE from "three";
import "./style.css";
import { RetroPass } from "./retro/retroPass";
import { psxUniforms } from "./retro/psx";
import { mountSettings, STREET_LEVELS, type GameSettings } from "./game/settings";
import { mountDevMenu } from "./game/devmenu";
import { setAmbientViewHeight } from "./world/ambient";
import { setFireViewHeight } from "./world/fire";
import { puddleAt } from "./world/puddlemask";
import { setMirrorScale } from "./world/mirror";
import { BOARD_POS, DOSS_POS, RAMP, SPOTS, buildRijnkaai } from "./world/rijnkaai";
import { FirstPerson } from "./player/firstPerson";
import { Soundscape } from "./audio/soundscape";
import { Jobs } from "./game/jobs";
import CITY from "../../shared/city.json";
import { Crowd, placesFromCity } from "./game/crowd";
import { Town } from "./game/town";
import { Animals } from "./game/animals";
import { Stalls } from "./game/stalls";
import { Ride } from "./game/ride";
import { CraneClimb } from "./game/craneclimb";
import { Deeds } from "./game/deeds";
import { Rowing } from "./game/rowing";
import { Market } from "./game/market";
import { setLitterClock } from "./world/litter";
import { createTrades } from "./world/trades";
import { createSteenLife } from "./world/steenlife";
import { Actions } from "./game/actions";
import { Bubbles } from "./game/bubbles";
import { Events } from "./game/events";
import { TownLife } from "./game/townlife";
import { Press } from "./game/press";
import { Ideas } from "./game/ideas";
import { Emigrants } from "./game/emigrants";
import { api } from "./net/api";
import { Interiors } from "./game/interiors";
import { Families } from "./game/families";
import { Homes } from "./game/homes";
import { Landmarks } from "./game/landmarks";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const startEl = document.getElementById("start") as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(1);

const world = buildRijnkaai();
const player = new FirstPerson(world, canvas);
const retro = new RetroPass(renderer);
let sound: Soundscape | null = null;
// the soundscape hears the clock and the weather the Day sets on the world (audio/soundscape.ts)
// null until the server has said: no foghorn before the weather is known
let peopleWired = false;
let weatherNow: "fog" | "mist" | "clear" | "rain" | "storm" | null = null;
{
  const setTimeOfDay = world.setTimeOfDay;
  world.setTimeOfDay = (h) => {
    setTimeOfDay(h);
    sound?.setClock(h);
  };
  const setWeather = world.setWeather;
  world.setWeather = (w) => {
    weatherNow = w;
    setWeather(w);
    sound?.setWeather(w);
  };
}
const jobs = new Jobs(world, player);
// the horse omnibus round the quays (M3g, game/ride.ts): E at a stop to get on or off; the server takes the fare
const ride = new Ride(player, world, () => world.omnibus(), (t) => jobs.say(t), (p) => jobs.refresh(p));
jobs.extraActions.push((x, z) => ride.keys(x, z));
// up a portal crane's ladder to its machinery deck (M3g, game/craneclimb.ts)
const craneClimb = new CraneClimb(player, world, (t) => jobs.say(t));
jobs.extraActions.push((x, z) => craneClimb.keys(x, z));
// townspeople on the quays and squares (game/crowd.ts)
const crowd = new Crowd(
  world.scene,
  { flags: world.city.flags, isFree: world.isFree, solids: world.solids, gate: world.bridgeWait, addCollider: world.addCollider, removeCollider: world.removeCollider },
  placesFromCity((CITY as unknown as { places: Record<string, { x: number; z: number; kind: string }> }).places),
  { mats: { sack: world.mats.sack, crate: world.mats.crate } },
);
// the town's residents (M3e): homes, families, trades and days, from the server;
// their dogs and the cats; the market stalls and shop fronts (game/town.ts)
const animals = new Animals(world.scene, { isFree: (x, z, r) => world.isFree(x, z, r) });
const stalls = new Stalls({ scene: world.scene, addCollider: world.addCollider });
const town = new Town(world, crowd, jobs.people, animals, stalls);
// M3i: market days on the Vismarkt and the Grote Markt (game/market.ts), and the working
// trades: boat yard, farrier, rope walk, cooper, sailmaker, net menders (world/trades.ts)
const market = new Market(world, crowd, town, stalls);
town.market = market;
animals.scraps = market.scrapSpots();
const trades = createTrades(world.scene, world.city.flags, { clock: () => ({ day: jobs.day.dayNum, hour: jobs.day.hourF }) });
// visitors at the Steen (the Museum of Antiquities), the attendant, a painter, an angler (world/steenlife.ts)
const steenLife = createSteenLife(world.scene, crowd);
for (const r of steenLife.colliders) world.addCollider(r);
for (const r of trades.colliders) world.addCollider(r);
jobs.town = town;
town.clock = () => ({ day: jobs.day.dayNum, hour: jobs.day.hourF });
// M6 tides: the river rises and falls with the game clock (world/tide.ts)
world.setTideClock(() => ({ day: jobs.day.dayNum, hour: jobs.day.hourF }));
town.canRob = () => !interiors.inside && !jobs.talk.isOpen && !jobs.day.sheetOpen && (player.locked || player.freeInput);
town.toast = (t) => jobs.say(t);
town.onPayload = (p) => jobs.refresh(p);
jobs.talk.onOpen = (id) => town.hold(id, true);
jobs.talk.onClose = (id) => town.hold(id, false);
// M3h: velocipedes, a lantern to carry, theft and the police (game/deeds.ts)
const deeds = new Deeds(world, player, jobs, town, crowd, stalls);
deeds.sfx = (name, at) => sound?.play(name, at);
// M3j: rowing boats for hire at three flights of steps, boats to steal, bridges and the lock (game/rowing.ts)
const rowing = new Rowing(world, player, jobs, deeds);
rowing.sfx = (name, at) => sound?.play(name, at);
rowing.stroke = () => sound?.swimStroke();
// M4: townspeople who act (game/actions.ts), the director's events (game/events.ts) and the
// conversations shown over their heads (game/bubbles.ts); the server decides all of it
const events = new Events(world, town, stalls);
const bubbles = new Bubbles(town);
const actions = new Actions(world, player, town, crowd, events);
actions.say = (t) => jobs.say(t);
actions.onPayload = (p) => {
  events.set(p);
  for (const c of p.convos) bubbles.show(c);
};
jobs.onPush = (m) => {
  actions.handlePush(m);
  if (m.type === "convo" && m.convo) bubbles.show(m.convo as import("./net/api").Convo);
};
bubbles.speak = (at, v, s) => sound?.speech(at, v, s);
// M6: the newsboys and the morning paper, letters, the post and telegraph, the Berg van Barmhartigheid (game/press.ts)
const press = new Press(world, player, jobs, town, bubbles);
{
  const onPush = jobs.onPush;
  jobs.onPush = (m) => {
    onPush(m);
    press.handlePush(m);
  };
}
// M6 AI ideas: bills on the walls, letters of your own, trouble on a job, lost things and notebooks (game/ideas.ts)
const ideas = new Ideas(world, player, jobs, town, press);
{
  const onPush = jobs.onPush;
  jobs.onPush = (m) => {
    onPush(m);
    ideas.handlePush(m);
  };
}
// M6: emigrant families on the Rijnkaai, the Logement, the runner, boarding the lighters (game/emigrants.ts)
const emigrants = new Emigrants(world, player, jobs, town, crowd, bubbles);
{
  const onPush = jobs.onPush;
  jobs.onPush = (m) => {
    onPush(m);
    emigrants.handlePush(m);
  };
}
// M6: inside the taverns and the Poesje's cellar (game/interiors.ts); first in the key list, so its keys win inside
const interiors = new Interiors(player, jobs, world.scene);
jobs.extraActions.unshift((x, z) => interiors.keys(x, z));
interiors.say = (t) => jobs.say(t);
interiors.sfx = (n) => sound?.indoors(() => sound?.play(n));
interiors.speak = (at, v, s) => sound?.indoors(() => sound?.speech(at, v, s));
interiors.roomSound = (k) => sound?.setInterior(k);
// M6 homes: rooms to rent, the night at home, furniture from the second-hand dealer (game/homes.ts); its door keys before the interiors' street keys
const homes = new Homes(world, player, jobs, interiors);
jobs.extraActions.unshift((x, z) => homes.keys(x, z));
homes.say = (t) => jobs.say(t);
// M6 landmark interiors: the cathedral, the town hall, the Vleeshuis, the Steen, the Oostershuis (game/landmarks.ts)
const landmarks = new Landmarks(player, jobs, interiors);
jobs.extraActions.unshift((x, z) => landmarks.keys(x, z));
landmarks.say = (t) => jobs.say(t);
landmarks.sfx = (n) => sound?.indoors(() => sound?.play(n));
landmarks.organ = (on) => sound?.organ(on);
landmarks.altarBell = () => sound?.altarBell();
{
  const onPush = jobs.onPush;
  jobs.onPush = (m) => {
    onPush(m);
    if (m.type === "convo" && m.convo) interiors.convo(m.convo as import("./net/api").Convo);
  };
}
// M4b: a scene's shout or the agent's word, as a bubble
actions.showLines = (c) => bubbles.show(c);
events.eventSound = (k, at, s) => sound?.eventSound(k, at, s) ?? null;
events.say = (t) => jobs.say(t);
// M6 town life: the lamplighters, the house fire and its bucket chain, the naties' hiring at dawn (game/townlife.ts)
const townLife = new TownLife(world, town, crowd, events);
townLife.say = (t) => jobs.say(t);
townLife.refresh = (p) => jobs.refresh(p);
townLife.showLines = (c) => bubbles.show(c);
townLife.actions = () => actions.active;
jobs.extraActions.push((x, z) => townLife.keys(x, z));
{
  const onPush = jobs.onPush;
  jobs.onPush = (m) => {
    onPush(m);
    townLife.handlePush(m);
  };
}
townLife.load().catch((e) => console.warn("town life did not load", e));
// M6 families and surprises (game/families.ts): visits, a menace, dreams, strangers, the fortune teller's table
const families = new Families(world, player, jobs, town);
{
  const onPush = jobs.onPush;
  jobs.onPush = (m) => {
    onPush(m);
    families.handlePush(m);
  };
}
town
  .load()
  .then(() => {
    for (const r of town.data!.residents) if (r.wares.length) jobs.talk.setWares(r.id, r.wares);
    void families.load();
    return market.build();
  })
  .catch((e) => console.warn("the town did not load; the old crowd stays", e));

// into the Schelde (player/firstPerson.ts): a splash, a word the first time, and the
// server takes the cold off your warmth (the client never changes needs itself)
let warnedCold = false;
player.onSplash = (x, z) => {
  sound?.play("splash", new THREE.Vector3(x, world.waterLevel(x, z), z));
  if (!warnedCold) {
    warnedCold = true;
    jobs.say("The water is ice cold. Find a ladder or steps.");
  }
  if (player.locked || player.freeInput) api.swim().then((p) => jobs.refresh(p)).catch(() => {});
};
player.onStroke = () => sound?.swimStroke();

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  const aspect = w / h;
  player.camera.aspect = aspect;
  player.camera.updateProjectionMatrix();
  retro.resize(aspect, h);
  // vertex snap grid: half the render resolution, so things wobble visibly (off: a grid too fine to see)
  // the wobble keeps its PS1 size at any render size (a 270-line grid)
  if (settings.wobble) psxUniforms.uSnapRes.value.set(Math.round(270 * aspect) * 0.5, 270 * 0.5);
  else psxUniforms.uSnapRes.value.set(1e5, 1e5);
  setAmbientViewHeight(retro.height);
  setFireViewHeight(retro.height);
  setMirrorScale(retro.height / 270);
}
window.addEventListener("resize", resize);
// the settings (Esc: the pause paper has a Settings button); applying them resizes
let settings: GameSettings = { height: 270, psxColour: true, wobble: true, street: "normal" };
settings = mountSettings(startEl.querySelector(".paper") as HTMLElement, (s) => {
  settings = s;
  retro.renderHeight = s.height;
  retro.setPsxColour(s.psxColour);
  town.maxPuppets = STREET_LEVELS[s.street].cap; // M6 population: people in the street
  resize();
});
// dev builds: a Dev button next to Settings (time, weather, events, jump to places)
if (import.meta.env.DEV) {
  mountDevMenu(startEl.querySelector(".paper") as HTMLElement, {
    place: (x, z) => player.place(x, z, 0),
    tide: world.tideDev,
    places: [
      { name: "Rijnkaai", x: 20, z: 20 },
      { name: "Werf", x: -270, z: 9 },
      { name: "Steenplein", x: -180, z: 20 },
      { name: "Het Steen (ramp)", x: -202.2, z: 0.5 },
      { name: "Vismarkt", x: -118, z: 30 },
      { name: "Vleeshuis", x: -122, z: 84 },
      { name: "Grote Markt", x: -254, z: 90 },
      { name: "Cathedral", x: -262, z: 138 },
      { name: "Canal", x: -64, z: 100 },
      { name: "Lock", x: 96, z: 26 },
      { name: "Petit Bassin", x: 120, z: 117 },
    ],
    events: [
      ...world.devEvents(),
      // M4: the director and its templates
      // the answer shows in the Dev panel itself (a toast would hide behind the pause paper)
      {
        label: "Director: think now",
        run: () =>
          api
            .devDirector({ think: true })
            .then((r) => {
              const p = r.planned as { ok?: boolean; title?: string; why?: string } | null;
              return `${r.decision} (${r.source})${p ? (p.ok ? `: planned "${p.title}"` : `: refused, ${p.why}`) : r.why ? `: ${r.why}` : ""}`;
            })
            .catch((e) => String(e)),
      },
      // M4b: AI first. The model must invent an event now; the engine's checks hold; the result shows here.
      {
        label: "Director: invent an event now",
        run: () =>
          api
            .devDirector({ invent: true })
            .then((r) =>
              r.ok
                ? `invented "${r.title}" (${r.kind}) at ${r.where}, starts in ${r.starts_in} game minutes. Stages: ${(r.stages as string[]).join("; ")}.${r.notice ? ` Notice: ${r.notice}` : ""} Why: ${r.why}`
                : `no event: ${r.why}`,
            )
            .catch((e) => String(e)),
      },
      ...["wedding", "funeral", "musicians", "emigrant_ship", "fish_auction", "quarrel", "scuffle", "street_robbery", "house_fire", "hiring"].map((t) => ({
        label: `Event: ${t.replace("_", " ")}`,
        run: () =>
          api
            .devDirector({ template: t })
            .then((r) => (r.ok ? `planned "${r.title}" at ${r.where}; it starts a game minute after you resume. Go there to see it.` : `refused: ${r.why}`))
            .catch((e) => String(e)),
      })),
    ],
  });
}

function start(): void {
  if (!sound) {
    sound = new Soundscape(
      world.lamps.map((l) => l.pos),
      world.shipPositions,
    );
    // in a puddle the step splashes (world/puddlemask.ts: the same puddles the ground shows)
    player.onStep = (surface, hurry) => {
      // M6: inside a room the steps are the room's, not the street's
      const step = () => sound?.footstep(surface, hurry, surface === "stone" && !interiors.inside ? puddleAt(player.x, player.z, 1.1) : 0);
      if (interiors.inside) sound?.indoors(step);
      else step();
    };
    jobs.sfx = (name, at) => sound?.play(name, at);
    player.onLand = (surface) => sound?.footstep(surface, true);
  }
  if (weatherNow) sound.setWeather(weatherNow);
  sound.resume();
  player.lock();
}
startEl.addEventListener("click", start);
// the pause screen: a walking key (or Space, Enter) goes back into the game, no click needed.
// (Esc cannot: browsers do not let the Esc key take the mouse back.)
window.addEventListener("keydown", (e) => {
  if (player.locked || startEl.classList.contains("hidden") || e.repeat) return;
  const t = document.activeElement as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
  if (document.querySelector(".settings:not([style*='none'])")) return; // a panel is open: its keys first
  if (["KeyW", "KeyA", "KeyS", "KeyD", "Space", "Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
    e.preventDefault();
    start();
  }
});
canvas.addEventListener("click", () => {
  if (!player.locked) start();
});
document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === canvas;
  startEl.classList.toggle("hidden", locked || player.freeInput);
});

const timer = new THREE.Timer();
timer.connect(document);
let elapsed = 0;
function frame(): void {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  elapsed += dt;
  world.update(elapsed, dt, player.camera);
  player.update(dt);
  interiors.update(dt);
  homes.update(dt);
  landmarks.update(dt);
  interiors.sway(dt);
  jobs.update(dt);
  craneClimb.update(dt);
  crowd.setHour(jobs.day.hour);
  crowd.update(dt, player, player.camera);
  town.update(dt, player);
  market.update(dt, player, jobs.day.dayNum, jobs.day.hourF);
  setLitterClock(jobs.day.dayNum, jobs.day.hourF);
  trades.update(elapsed, dt, player.camera, crowd.fogDistance);
  steenLife.update(dt, jobs.day.hourF, player.camera);
  deeds.update(dt, jobs.day.hourF);
  rowing.update(dt);
  actions.update(dt);
  families.update(dt);
  events.update(dt, player);
  townLife.update(dt, player, jobs.day.hourF);
  bubbles.update(dt, player.camera);
  press.update(dt);
  ideas.update(dt);
  emigrants.update(dt);
  animals.update(dt, player, player.camera, crowd.fogDistance, jobs.day.hour >= 19 || jobs.day.hour < 7);
  sound?.setCrowd(crowd.stats.drawn);
  sound?.setRain(psxUniforms.uRain.value);
  sound?.update(player.camera);
  {
    // ships under way whistle and churn; they signal at the lock and the bridges
    const b = world.boats();
    if (b && sound) {
      sound.setMovingShips(b.moving());
      if (!b.onSignal) b.onSignal = (ship, at) => sound?.shipSignal(ship, at);
    }
    const tr = world.traffic();
    // the goods train's horses and the omnibus: hooves and wheels (M3g); rail joints and crane work
    const rail = world.railway();
    const bus = world.omnibus();
    if (rail && sound && !rail.onClack) {
      rail.onClack = (x, z) => sound?.railClack(x, z);
      rail.onCrane = (x, z) => sound?.craneWork({ kind: "crane", x, z, y: 6 });
      world.railGate().onBell = (x, z) => sound?.gateBell(x, z);
      rail.onCraneTravel = (x, z) => sound?.gateBell(x, z); // the crane driver's warning bell
    }
    // the ridden velocipede rattles like a handcart: iron tyres on stone (M3h)
    if (tr || rail || bus || deeds.velos.ridden)
      sound?.setVehicles([...(tr?.info() ?? []), ...(rail?.vehicles() ?? []), ...(bus?.vehicles() ?? []), ...deeds.velos.sounds()]);
  }
  {
    // the goods train and the omnibus stop for the people walking in front of them
    const rail = world.railway();
    if (rail && !rail.people) rail.people = () => crowd.positions();
    if (!peopleWired) {
      // bridges never open under anyone walking
      world.setPeople(() => crowd.positions());
      peopleWired = true;
    }
    const bus = world.omnibus();
    if (bus && !bus.people) bus.people = () => crowd.positions();
  }
  // M6: inside a room, its own scene instead of the street
  retro.render(interiors.prepareRender(player.camera) ?? world.scene, player.camera, elapsed);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Warm-up: once the city is in, send every house chunk and landmark to the GPU
// and build every shader now, not the first time you walk up to them (that was
// the stutter).
world.city.ready.then(() => {
  const hidden: THREE.Object3D[] = [];
  world.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
      o.frustumCulled = false;
    }
  });
  renderer.compile(world.scene, player.camera);
  retro.render(world.scene, player.camera, elapsed);
  world.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.frustumCulled = true;
  });
  for (const o of hidden) o.visible = false;
}).catch(() => {});

// Dev fly mode (F9): fly anywhere, no fog, noon light; a readout of where you are.
if (import.meta.env.DEV) {
  const hud = document.createElement("div");
  hud.className = "devfly";
  hud.style.display = "none";
  document.body.appendChild(hud);
  let back: { x: number; z: number } | null = null;
  const toggleFly = () => {
    player.fly = !player.fly;
    world.setDevView(player.fly);
    hud.style.display = player.fly ? "block" : "none";
    if (player.fly) {
      back = { x: player.x, z: player.z };
      player.flyY = player.camera.position.y;
    } else if (back) {
      // land where you are if you can stand there, else back where you took off
      const free = world.isFree(player.x, player.z, 0.35);
      player.place(free ? player.x : back.x, free ? player.z : back.z, player.yaw, player.pitch);
    }
  };
  window.addEventListener("keydown", (e) => {
    if (e.code === "F9") {
      e.preventDefault();
      toggleFly();
    }
  });
  setInterval(() => {
    if (!player.fly) return;
    const p = player.camera.position;
    hud.textContent = `DEV FLY  x ${p.x.toFixed(0)}  y ${p.y.toFixed(0)}  z ${p.z.toFixed(0)}   WASD fly, mouse look, Space up, C down, Shift fast, F9 land`;
  }, 200);
}

// Dev hook for automated checks: teleport, hold keys, read state.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__scheldemist = {
    player,
    world,
    jobs,
    crowd,
    town,
    animals,
    stalls,
    market,
    trades,
    steenLife,
    ride,
    craneClimb,
    deeds,
    rowing,
    actions,
    events,
    townLife,
    bubbles,
    interiors,
    families,
    homes,
    landmarks,
    /** M6: a picture inside the room Jef is in, camera at `from` looking at `to` (room frame: x across, y up, z into the house). */
    async shotIn(name: string, from: [number, number, number], to: [number, number, number]) {
      const cam = player.camera;
      const keep = { p: cam.position.clone(), q: cam.quaternion.clone() };
      if (!interiors.devCamera(cam, from, to)) return "not inside";
      retro.render(interiors.prepareRender(cam)!, cam, elapsed);
      const url = canvas.toDataURL("image/jpeg", 0.85);
      cam.position.copy(keep.p);
      cam.quaternion.copy(keep.q);
      const r = await fetch("/api/dev/shot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, url }) });
      return r.ok ? `data/shots/${name}.jpg` : `failed ${r.status}`;
    },
    press,
    ideas,
    /** M6 ideas: the page on screen over the game picture, to data/shots/<name>.jpg. */
    pageShot: (name: string) => {
      crowd.update(0.0001, player, player.camera);
      retro.render(interiors.prepareRender(player.camera) ?? world.scene, player.camera, elapsed);
      return ideas.pageShot(name, canvas);
    },
    emigrants,
    get sound() {
      return sound;
    },
    free(on = true) {
      player.freeInput = on;
      startEl.classList.toggle("hidden", on);
      if (on && !sound) start();
    },
    key(code: string, down: boolean) {
      player.setKey(code, down);
    },
    /**
     * Path check (CLAUDE.md): can Jef walk from the start to every job place,
     * every person, the board, and the mate's spot on deck? Lists what he cannot reach.
     */
    paths() {
      const can = world.reachFrom(10, 12);
      const bad: string[] = [];
      for (const [id, s] of Object.entries(SPOTS)) if (!can(s.x, s.z, 1.7)) bad.push(`spot ${id}`);
      for (const n of jobs.people.list) {
        const reach = n.def.talks ? 2.4 : 5; // the sailor only needs to be called from the gangway foot
        if (!can(n.pos.x, n.pos.z, reach)) bad.push(`person ${n.def.name}`);
      }
      if (!can(BOARD_POS.x, BOARD_POS.z, 2.5)) bad.push("hiring board");
      // M3e: every home, workplace, stall front and post of the town
      for (const q of town.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
      // M3h: the velocipedes, the lanterns, the food tables, the police post
      for (const q of deeds.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
      // M3j: the boat hire landings and the boats lying at other steps
      for (const q of rowing.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
      // M3i: the trades (the market stalls come through town.pathPoints())
      for (const q of trades.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
      for (const q of steenLife.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
      // M6: the tavern doors and the Poesje's cellar door
      for (const q of interiors.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
      // M6: the newsboys' corners, the post office, the Berg
      for (const q of press.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
      // M6 AI ideas: the bills, lost things and notebooks, the owners' doors, a meeting, a trouble's step
      for (const q of ideas.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
      // M6 town life: the lamplighters' stands at every lamp
      for (const q of townLife.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
      // M6: the Logement door, the emigrants' places on the quay, the Red Star Line notice
      for (const q of emigrants.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
      // M6 homes: every home's door and the second-hand dealer
      for (const q of homes.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
      // M6 landmark interiors: every landmark door
      for (const q of landmarks.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
      if (!can(DOSS_POS.x, DOSS_POS.z, 2.0)) bad.push("the doss house gate");
      if (!can(RAMP.x - 0.6, RAMP.zHigh - 1.0, 2.4)) bad.push("the mate on deck");
      return bad;
    },
    /** Save a picture of the game to data/shots/<name>.jpg (dev server). */
    async shot(name = "shot") {
      // people and animals decide what is in view from the camera: ask them again for this one
      crowd.update(0.0001, player, player.camera);
      animals.update(0.0001, player, player.camera, crowd.fogDistance, false);
      retro.render(world.scene, player.camera, elapsed);
      const url = canvas.toDataURL("image/jpeg", 0.85);
      const r = await fetch("/api/dev/shot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, url }) });
      return r.ok ? `data/shots/${name}.jpg` : `failed ${r.status}`;
    },
    /** A picture from any point: camera at `from`, looking at `to` (world metres). */
    async shotFrom(name: string, from: [number, number, number], to: [number, number, number], fogFar = 0) {
      const cam = player.camera;
      const keep = { p: cam.position.clone(), q: cam.quaternion.clone() };
      cam.position.set(...from);
      cam.lookAt(...to);
      cam.updateMatrixWorld();
      world.update(elapsed, 0.016, cam);
      crowd.update(0.0001, player, cam);
      animals.update(0.0001, player, cam, fogFar || crowd.fogDistance, false);
      const fog = world.scene.fog as THREE.Fog;
      const keepFog = [fog.near, fog.far];
      if (fogFar) {
        fog.near = fogFar * 0.3;
        fog.far = fogFar;
        world.city.update(cam, fogFar);
      }
      retro.render(world.scene, cam, elapsed);
      [fog.near, fog.far] = keepFog;
      const url = canvas.toDataURL("image/jpeg", 0.85);
      cam.position.copy(keep.p);
      cam.quaternion.copy(keep.q);
      const r = await fetch("/api/dev/shot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, url }) });
      return r.ok ? `data/shots/${name}.jpg` : `failed ${r.status}`;
    },
    /** Time n frames with the GPU finished each frame; draw calls and triangles of one frame. */
    perf(n = 30) {
      const gl = renderer.getContext();
      const px = new Uint8Array(4);
      renderer.info.autoReset = false;
      const t0 = performance.now();
      let calls = 0;
      let tris = 0;
      for (let i = 0; i < n; i++) {
        renderer.info.reset();
        world.update(elapsed, 1 / 60, player.camera);
        retro.render(interiors.prepareRender(player.camera) ?? world.scene, player.camera, elapsed);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        calls = renderer.info.render.calls;
        tris = renderer.info.render.triangles;
      }
      const ms = (performance.now() - t0) / n;
      renderer.info.autoReset = true;
      return { msPerFrame: +ms.toFixed(2), calls, tris };
    },
    /** Run the game logic for some seconds at 60 Hz, without waiting for frames. */
    step(seconds: number) {
      const dt = 1 / 60;
      for (let t = 0; t < seconds; t += dt) {
        elapsed += dt;
        world.update(elapsed, dt);
        player.update(dt);
        interiors.update(dt);
        homes.update(dt);
        landmarks.update(dt);
        jobs.update(dt);
        crowd.update(dt, player, player.camera);
        town.update(dt, player);
        market.update(dt, player, jobs.day.dayNum, jobs.day.hourF);
        setLitterClock(jobs.day.dayNum, jobs.day.hourF);
        trades.update(elapsed, dt, player.camera, crowd.fogDistance);
        steenLife.update(dt, jobs.day.hourF, player.camera);
        deeds.update(dt, jobs.day.hourF);
        rowing.update(dt);
        actions.update(dt);
        families.update(dt);
        events.update(dt, player);
        townLife.update(dt, player, jobs.day.hourF);
        bubbles.update(dt, player.camera);
        press.update(dt);
        ideas.update(dt);
        emigrants.update(dt);
        animals.update(dt, player, player.camera, crowd.fogDistance, jobs.day.hour >= 19 || jobs.day.hour < 7);
      }
    },
    info() {
      return {
        x: +player.x.toFixed(2),
        z: +player.z.toFixed(2),
        surface: world.surfaceAt(player.x, player.z),
        audio: sound?.state ?? "none",
        horns: sound?.hornCount ?? 0,
        target: [retro.width, retro.height],
      };
    },
  };
}

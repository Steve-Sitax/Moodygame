// M7 save and pause: first of all, so the pause clock is in place before any other part runs (game/pause.ts)
import { onPausedKey, pause, real } from "./game/pause";
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
import { Culler, mountCullHud } from "./world/cull";
import { buildHeightfield } from "./world/occlusion";
import { OUTSIDE, WATER } from "./world/city";
import { water as tideWater } from "./world/tide";
import { BOARD_POS, DOSS_POS, RAMP, SPOTS, buildRijnkaai } from "./world/rijnkaai";
import { InWorld } from "./world/inworld";
import { loadHousePlans } from "./world/houses";
import { LanternLights } from "./world/lanternLights";
import { FirstPerson } from "./player/firstPerson";
import { Soundscape, type VehicleSound } from "./audio/soundscape";
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
import { Journeys } from "./game/journeys";
import { Market } from "./game/market";
import { setLitterClock } from "./world/litter";
import { clutterInfo, streetEndCheck } from "./world/clutter";
import { pruneQuayGoods, quayGoodsInfo, quayGoodsMap, quayGoodsShowroom, quayGoodsWhy, quayGoodsKeepAt } from "./world/quaygoods";
import { createTrades } from "./world/trades";
import { createSteenLife } from "./world/steenlife";
import { Actions } from "./game/actions";
import { Hearses } from "./game/hearses";
import { Bubbles } from "./game/bubbles";
import { Events } from "./game/events";
import { TownLife } from "./game/townlife";
import { Press } from "./game/press";
import { Ideas } from "./game/ideas";
import { Emigrants } from "./game/emigrants";
import { api } from "./net/api";
import { Interiors } from "./game/interiors";
import { shopCaller } from "./game/shopCalls";
import { Families } from "./game/families";
import { Homes } from "./game/homes";
import { Landmarks } from "./game/landmarks";
import { Ballads } from "./game/ballads";
import { Handcarts } from "./game/handcart";
import { routeClips } from "./dev/routeClips";
import { checkSigns } from "./dev/signcheck";
import { Lively } from "./game/lively";
import { Steps } from "./game/steps";
import { Hands } from "./game/hands";
import { figureNav } from "./game/figures";
import { FerryArrival } from "./game/ferryArrival";
import { JUMPS, makeTestKit } from "./dev/testkit";
import { QuestBoxes } from "./game/questboxes";
import { Nightlife } from "./game/nightlife";
import { Saves } from "./game/saves";
import { carolusInWorld } from "./world/carolusHall";
import { prisonInWorld } from "./world/prisonHall"; // M7 prison and squares
import { townPlacePoints } from "./world/townplaces"; // M7 prison and squares
import { gothicInWorld } from "./world/gothicHall";
// M7 alive (docs/milestones/M7-alive.md): the town's small life that is not people (hook)
import { createAlive } from "./world/alive";
// M7 back of town (docs/milestones/M7-back-of-town.md): the pump, the corner gangs, cards, doorsteps, the park, the watch (hook)
import { BackLife } from "./game/backlife";
import { setAliveViewHeight } from "./world/alive/common";
import { bootRestore, type ClientState } from "./game/restoreData";
import type { JobSnap } from "./game/jobs";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const startEl = document.getElementById("start") as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(1);

const world = buildRijnkaai();
// carried lanterns light the world: a pool of real lights (the nearest throws shadows), ground pools
// for the rest (world/lanternLights.ts). Made before any shader is built: it switches shadows on.
const lanternLights = new LanternLights(world.scene, renderer, (x, z, feet) => world.groundAt(x, z, 0, feet));
/** How dark it is by the clock, 0..1 (deeds.ts reckons Jef's lantern the same way). */
function lanternDark(): number {
  const h = jobs.day.hourF;
  const dark = h >= 19.5 || h < 5.5 ? 1 : h >= 18 ? (h - 18) / 1.5 : h < 7 ? (7 - h) / 1.5 : 0;
  return Math.max(0, Math.min(1, dark));
}
const player = new FirstPerson(world, canvas);
const retro = new RetroPass(renderer);
// M7 rendering: what cannot be seen is not drawn: beyond the fog, behind the houses, the mirrors'
// extra passes, the river mirror when no water shows (world/cull.ts, world/occlusion.ts)
const cull = new Culler(world.scene, {
  heights: world.city.ready.then(() => buildHeightfield(world.city.flags, WATER, OUTSIDE)),
  waterTop: () => Math.max(tideWater.river, tideWater.dock, tideWater.chamberA, tideWater.chamberB),
  paused: () => player.fly,
  // M7 taverns and homes: inside a city house its own walls would hide the street out of its windows
  noOcclusion: () => !!inWorld.here?.budgeted,
});
retro.cull = cull;
// M7: interiors in the world, drawn through their doors (world/inworld.ts): the cathedral first
const inWorld = new InWorld(world.scene);
retro.inWorld = inWorld;
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
  {
    flags: world.city.flags, isFree: world.isFree, solids: world.solids, solidsVersion: world.solidsVersion, gate: world.bridgeWait, addCollider: world.addCollider, removeCollider: world.removeCollider, addMover: world.addMover, removeMover: world.removeMover,
    // M7 back of town (hook): people stand on the ground where it is raised (the walk on the ramparts, stairs, bridges);
    // without it the Sunday strollers on the wall walked inside it at street level
    baseAt: (x: number, z: number) => world.baseAt(x, z),
  },
  placesFromCity((CITY as unknown as { places: Record<string, { x: number; z: number; kind: string }> }).places),
  { mats: { sack: world.mats.sack, crate: world.mats.crate } },
);
// the town's residents (M3e): homes, families, trades and days, from the server;
// their dogs and the cats; the market stalls and shop fronts (game/town.ts)
// the animals walk where the people walk: goals they can reach, on the crowd's walk grid
const animals = new Animals(world.scene, {
  isFree: (x, z, r) => world.isFree(x, z, r),
  canStand: (x, z) => crowd.canStand(x, z),
  openNear: (x, z) => crowd.openNear(x, z),
  path: (ax, az, bx, bz) => crowd.pathOn(ax, az, bx, bz),
  heightAt: (x, z, feet) => world.groundAt(x, z, 0.2, feet),
});
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
// M7 alive (hook): leaves in the wind, birds, bats, moths, drips, mist, buoys, thunder (world/alive/)
const alive = createAlive(world.scene, world, () => sound);
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
// M6 transport: residents go by velocipede, handcart, dray, omnibus or boat (game/journeys.ts)
const journeys = new Journeys(world, crowd, deeds.velos, rowing, town.journeyHost());
town.journeys = journeys;
journeys.say = (t) => jobs.say(t);
journeys.onJefVelos = () => void deeds.load();
// M4: townspeople who act (game/actions.ts), the director's events (game/events.ts) and the
// conversations shown over their heads (game/bubbles.ts); the server decides all of it
const events = new Events(world, town, stalls);
const bubbles = new Bubbles(town);
const actions = new Actions(world, player, town, crowd, events);
// M7 funeral: the hearse of a funeral's departure (game/hearses.ts); the column walks after it
const hearses = new Hearses(world, town);
actions.hearses = hearses;
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
// M7 shops: E at the Berg's counter inside the pawn office opens the Berg's page (game/press.ts)
interiors.bergCounter = () => press.openBergCounter();
// M7: while a tavern is open its keeper and drinkers are inside, at the counter and the tables
town.tavernInside = (pl) => interiors.tavernOpen(pl);
// M7 shops: a shop's keeper, his wife and the customers the engine's roll sends in go in at its door (game/town.ts)
town.shopCall = shopCaller(() => town.data);
// M6 homes: rooms to rent, the night at home, furniture from the second-hand dealer (game/homes.ts); its door keys before the interiors' street keys
const homes = new Homes(world, player, jobs, interiors);
jobs.extraActions.unshift((x, z) => homes.keys(x, z));
homes.say = (t) => jobs.say(t);
// M6 landmark interiors: the cathedral, the town hall, the Vleeshuis, the Steen, the Oostershuis (game/landmarks.ts)
const landmarks = new Landmarks(player, jobs, interiors);
// M7 funeral: an event's people come out of the cathedral once their figure inside has walked to the door
actions.insideFig = (id) => landmarks.hasFig(id);
jobs.extraActions.unshift((x, z) => landmarks.keys(x, z));
landmarks.say = (t) => jobs.say(t);
landmarks.sfx = (n) => sound?.indoors(() => sound?.play(n));
landmarks.organ = (on) => sound?.organ(on);
landmarks.altarBell = () => sound?.altarBell();
landmarks.speak = (at, v, s) => sound?.indoors(() => sound?.speech(at, v, s));
// M7: the cathedral's hall stands in the world; Jef walks in through the west door (world/cathedralInWorld.ts)
landmarks.attachWorld(world, inWorld);
landmarks.roomSound = (k) => sound?.setInterior(k);
// M7 Carolus: Sint-Carolus Borromeus stands in the world too, walked into through its main door (world/carolusHall.ts)
const carolus = carolusInWorld(world, inWorld, { roomSound: (k) => sound?.setInterior(k), say: (t) => jobs.say(t), jef: () => player });
// M7 prison and squares: the prison in the Begijnenstraat, walked in through its gate in visiting hours (world/prisonHall.ts)
const prison = prisonInWorld(world, inWorld, {
  roomSound: (k) => sound?.setInterior(k),
  say: (t) => jobs.say(t),
  jef: () => player,
  talk: (id, name) => jobs.talk.open({ id, def: { name } }),
});
jobs.extraActions.push((x, z) => {
  const a = prison.action(x, z);
  return a ? { options: [[0.5, { key: "KeyE", text: a.label, run: () => a.run(), self: true }]] } : {};
});
// M7 Paul and James: St Paul's and St James's in the world too, walked into through their west doors (world/gothicHall.ts)
const gothic = gothicInWorld(world, inWorld, { roomSound: (k) => sound?.setInterior(k), say: (t) => jobs.say(t), jef: () => player });
// M7 taverns and homes: the taverns, the Poesje and the homes stand inside their own city houses; walked into
// through their doors, seen through their windows (world/houseInWorld.ts, shared/housePlan.ts)
void loadHousePlans().then((plans) => {
  interiors.attachWorld(world, inWorld, plans);
  homes.attachWorld(inWorld, plans);
});
{
  const dayK = () => {
    const h = jobs.day.hourF;
    return Math.max(0, Math.min(1, h < 12 ? (h - 6.5) / 3 : (18.5 - h) / 3));
  };
  interiors.daylight = dayK;
  homes.daylight = dayK;
}
landmarks.daylight = () => {
  const h = jobs.day.hourF;
  const day = Math.max(0, Math.min(1, h < 12 ? (h - 6.5) / 3 : (18.5 - h) / 3));
  const sky = { fog: 0.7, mist: 0.8, clear: 1, rain: 0.6, storm: 0.5 }[weatherNow ?? "fog"];
  return { day, sky };
};
{
  const onPush = jobs.onPush;
  jobs.onPush = (m) => {
    onPush(m);
    if (m.type === "convo" && m.convo) interiors.convo(m.convo as import("./net/api").Convo);
  };
}
// M6 ballads: the ballad singer at his corners and in a tavern, his sheets (game/ballads.ts); the Sunday sermon is in game/landmarks.ts
const ballads = new Ballads(player, jobs, town, interiors);
ballads.sing = (at, v, notes, beat, inside) => {
  const s = sound;
  if (!s) return 0;
  let secs = 0;
  if (inside) s.indoors(() => (secs = s.sing(at, v, notes, beat)));
  else secs = s.sing(at, v, notes, beat);
  return secs;
};
{
  const onPush = jobs.onPush;
  jobs.onPush = (m) => {
    onPush(m);
    ballads.handlePush(m);
  };
}
// M4b: a scene's shout or the agent's word, as a bubble
actions.showLines = (c) => bubbles.show(c);
events.eventSound = (k, at, s) => sound?.eventSound(k, at, s) ?? null;
// fixes 2026-09-24: the job figures (a thief, a stranger, a foreman) walk the crowd's grid, never over the water
figureNav.path = (ax, az, bx, bz) => crowd.pathOn(ax, az, bx, bz);
figureNav.water = (x, z) => world.isWater(x, z);
// M7 ferry arrival: a new game begins on the ferry's deck at the Werf pontoon (game/ferryArrival.ts)
const ferry = new FerryArrival({ world, player, say: (t) => jobs.say(t), path: (ax, az, bx, bz) => crowd.pathOn(ax, az, bx, bz) });
events.eventCues = (cues, at, s) => sound?.eventCues(cues, at, s) ?? null;
events.say = (t) => jobs.say(t);
// M6 town life: the lamplighters, the house fire and its bucket chain, the naties' hiring at dawn (game/townlife.ts)
const townLife = new TownLife(world, town, crowd, events);
townLife.say = (t) => jobs.say(t);
townLife.fogDay = () => jobs.day.lampsFog;
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
// M6 handcart: Jef's own cart (bought, hired, taken), loads by size and weight (game/handcart.ts); first in the key list: holding the shafts, only its keys
const handcarts = new Handcarts(world, player, jobs, deeds, journeys, homes);
jobs.extraActions.unshift((x, z) => handcarts.keys(x, z));
handcarts.say = (t) => jobs.say(t);
handcarts.sfx = (name, at) => sound?.play(name, at);
handcarts.away = () => interiors.inside;
handcarts.people = () => crowd.positions();
// fixes 2026-09-24: the lock gates' balance beams wait for carts in their way (world/lock.ts)
world.setCarts(() => handcarts.allPoints());
// M6 families and surprises (game/families.ts): visits, a menace, dreams, strangers, the fortune teller's table
const families = new Families(world, player, jobs, town);
{
  const onPush = jobs.onPush;
  jobs.onPush = (m) => {
    onPush(m);
    families.handlePush(m);
  };
}
// M6 gifts and hired hands: routines of steps the server runs (game/steps.ts walks them), a thing handed
// over, a drink stood at the tavern, hands paid to carry (game/hands.ts); after the ballads (their tavern keys)
const steps = new Steps(world, player, town, crowd, jobs);
steps.say = (t) => jobs.say(t);
const hands = new Hands(player, jobs, town, crowd, interiors, steps);
hands.say = (t) => jobs.say(t);
hands.sfx = (n) => sound?.play(n);
{
  const onPush = jobs.onPush;
  jobs.onPush = (m) => {
    onPush(m);
    hands.handlePush(m);
  };
}
const routinesRun = () => actions.active.some((a) => (a.kind as string) === "routine");
// M6 lively: the back streets and the cathedral quarter: dog carts, street sellers and their cries,
// door life, the children's games, the stalls against the cathedral, lane life (game/lively.ts)
const lively = new Lively(world, town, crowd);
town.lively = lively.hook();
lively.clock = () => ({ day: jobs.day.dayNum, hour: jobs.day.hourF });
lively.weather = () => weatherNow;
lively.sfx = {
  cry: (at, v, notes, beat) => void sound?.sing(at, v, notes, beat),
  work: (kind, at, secs) => sound?.streetWork(kind, at, secs),
  bell: (at) => void sound?.eventSound("handbell", at, 3),
};
lively.load().catch((e) => console.warn("the lively streets did not load", e));
// M7 back of town (hook): what the back's people do at the places of their day (game/backlife.ts)
const backLife = new BackLife(world, town, crowd);
town.back = backLife.hook();
backLife.clock = () => ({ day: jobs.day.dayNum, hour: jobs.day.hourF });
backLife.weather = () => weatherNow ?? "clear";
backLife.say = (c) => bubbles.show(c);
// M7 night: the employers' quest boxes by their doors (game/questboxes.ts), and the gangs (game/nightlife.ts)
const boxes = new QuestBoxes(world, jobs.people, town);
boxes.clock = () => ({ day: jobs.day.dayNum, hour: jobs.day.hourF });
jobs.boxes = boxes;
const night = new Nightlife(world, player, jobs, town);
night.indoors = () => interiors.inside || landmarks.indoors || carolus.indoors || gothic.indoors || prison.indoors;
{
  const onPush = jobs.onPush;
  jobs.onPush = (m) => {
    onPush(m);
    night.handlePush(m);
  };
}
void night.load();
town
  .load()
  .then(() => {
    boxes.build();
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
  if (w < 1 || h < 1) return; // a minimised window: no Infinity aspect, no zero-size target
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
  setAliveViewHeight(retro.height); // M7 alive (hook)
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
    places: JUMPS,
    events: [
      ...world.devEvents(),
      // M7 rendering: the culler off for comparison, occlusion alone off, and the view of what it hides
      { label: "Culling on/off", run: () => `culling ${(cull.enabled = !cull.enabled) ? "on" : "off: everything is drawn"}` },
      { label: "Occlusion on/off", run: () => `occlusion by the houses ${(cull.occlusion = !cull.occlusion) ? "on" : "off (the fog and the mirrors still cull)"}` },
      { label: "Culling view on/off", run: () => `culling view ${(cull.view = !cull.view) ? "on: hidden things drawn through the walls, red behind houses, amber beyond the fog" : "off"}` },
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
      ...["wedding", "funeral", "musicians", "emigrant_ship", "fish_auction", "quarrel", "scuffle", "street_robbery", "house_fire", "hiring", "tavern_brawl", "burglary", "smuggling", "night_watch"].map((t) => ({
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
      // M7: and in the cathedral's nave in the world (M7 halls: and in any hall in the world)
      const indoors = interiors.inside || landmarks.indoors || carolus.indoors || gothic.indoors || prison.indoors;
      const step = () => sound?.footstep(surface, hurry, surface === "stone" && !indoors ? puddleAt(player.x, player.z, 1.1) : 0);
      if (indoors) sound?.indoors(step);
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
// Steve: going to another app (a snipping tool) must not open the menu; Esc opens it, Esc again closes it.
// Away (the window lost focus): only a small hint in the corner. Back: click or a walking key goes on.
// M7 save and pause: once the game has been entered, the game is paused whenever it does not have
// the mouse (the menu, another window, another tab) and while P holds it (the "Paused" card); the
// first screen of a page is not a pause (the town may run behind it, the clock does not).
const resumeEl = document.createElement("div");
resumeEl.className = "resume-hint hidden pause-ui";
resumeEl.textContent = "Click or press W to go on · Esc: menu";
document.body.appendChild(resumeEl);
const pauseCard = document.createElement("div");
pauseCard.className = "pause-card pause-ui";
pauseCard.style.display = "none";
pauseCard.innerHTML = `<div class="paper"><h1>Paused</h1><p class="sub">Nothing moves in the town until you go on.</p><p class="keys">P, W or a click to go on &middot; Esc: the menu</p></div>`;
document.body.appendChild(pauseCard);
const stamp = document.createElement("p");
stamp.className = "paused-stamp";
stamp.textContent = "Paused";
stamp.style.display = "none";
startEl.querySelector(".paper")?.prepend(stamp);
/** Paused without the menu: after the window lost focus, or the menu was closed with Esc. */
let quietPause = false;
/** The game has been entered in this page (the first screen is not a pause). */
let started = false;
const hintEl = startEl.querySelector(".hint");
const hintText = hintEl?.textContent ?? "";
function showMenu(on: boolean): void {
  // once in the game, the paper says how to go on (a loaded save's line was for the first screen)
  if (on && started && hintEl) hintEl.textContent = hintText.replace("to walk", "to go on");
  startEl.classList.toggle("hidden", !on);
  resumeEl.classList.toggle("hidden", on || player.locked || player.freeInput || !quietPause || pause.has("key"));
  stamp.style.display = started && on ? "" : "none";
  if (on) saves.showMenu(started);
  else saves.closePanel();
  syncPause();
}
/** The menu reason: entered once, and the menu is up or the game does not have the mouse (the dev's free input has it). */
function syncPause(): void {
  pause.set("menu", started && (!startEl.classList.contains("hidden") || !(player.locked || player.freeInput)));
}
/** P: the "Paused" card; P, W or a click again goes on. */
function keyPause(on: boolean): void {
  if (on === pause.has("key")) return;
  pauseCard.style.display = on ? "flex" : "none";
  pause.set("key", on);
  if (on) {
    if (player.locked) document.exitPointerLock();
    resumeEl.classList.add("hidden");
  } else start();
}
pause.onChange((p) => {
  // the sound stops with the picture and comes back with it
  const ctx = (sound as unknown as { ctx?: BaseAudioContext } | null)?.ctx;
  if (ctx instanceof AudioContext) {
    if (p && ctx.state === "running") void ctx.suspend().catch(() => {});
    else if (!p) sound?.resume();
  }
});
const RESUME_KEYS = ["KeyW", "KeyA", "KeyS", "KeyD", "Space", "Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
const panelsOpen = () => [...document.querySelectorAll<HTMLElement>(".settings")].filter((p) => p.style.display !== "none");
/** Keys on the menu, the card, a panel: before the game is entered, and (game/pause.ts) while paused. */
function menuKey(e: KeyboardEvent, typing: boolean): void {
  if (e.repeat) return;
  if (pause.has("saving") || pause.has("loading")) return; // wait for it
  if (e.code === "Escape") {
    e.preventDefault();
    // a panel open (Settings, Save, Load, Dev): Esc closes it
    const open = panelsOpen();
    if (open.length) {
      for (const p of open) p.style.display = "none";
      return;
    }
    if (pause.has("key")) {
      // from the card to the menu (the menu's pause first: no moment of play between them)
      pauseCard.style.display = "none";
      quietPause = false;
      showMenu(true);
      pause.set("key", false);
      return;
    }
    const menuOpen = !startEl.classList.contains("hidden");
    quietPause = menuOpen;
    showMenu(!menuOpen);
    return;
  }
  if (typing) {
    // Enter in a save's name: save there
    if (e.code === "Enter") (e.target as HTMLElement).closest("li")?.querySelector<HTMLButtonElement>("button[name=go]")?.click();
    return;
  }
  if (panelsOpen().length) return;
  if (e.code === "KeyP" && pause.has("key")) {
    e.preventDefault();
    keyPause(false);
    return;
  }
  if (RESUME_KEYS.includes(e.code)) {
    e.preventDefault();
    if (pause.has("key")) keyPause(false);
    else start();
  }
}
onPausedKey(menuKey);
window.addEventListener("keydown", (e) => {
  // P in the game: the pause (the gang's and the menace's own P go first: they stop the key)
  if (e.code === "KeyP" && !e.repeat && (player.locked || player.freeInput) && !pause.paused && !jobs.day.sheetOpen) {
    const t = document.activeElement as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
    e.preventDefault();
    keyPause(true);
    return;
  }
  if (player.locked || player.freeInput) return;
  const menuOpen = !startEl.classList.contains("hidden");
  if (!menuOpen && !quietPause) return;
  const t = document.activeElement as HTMLElement | null;
  menuKey(e, !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT"));
});
canvas.addEventListener("click", () => {
  if (pause.has("key")) keyPause(false);
  else if (!player.locked) start();
});
pauseCard.addEventListener("click", () => keyPause(false));
let lostFocusAt = -1e9;
window.addEventListener("blur", () => (lostFocusAt = real.now()));
document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === canvas;
  if (locked || player.freeInput) {
    started = true;
    quietPause = false;
    startEl.classList.add("hidden");
    resumeEl.classList.add("hidden");
    saves.closePanel();
    syncPause();
    return;
  }
  // at once: nothing moves from the moment the mouse is let go
  syncPause();
  // P: the card is up, not the menu
  if (pause.has("key")) return;
  // the mouse was let go: by Esc (the window still has focus) or by going to another app (it has not).
  // The focus change can come a moment after the lock change, so look again shortly (a real timer:
  // the game's own timers wait for the unpause).
  real.setTimeout(() => {
    if (player.locked || player.freeInput || pause.has("key")) return;
    const away = !document.hasFocus() || real.now() - lostFocusAt < 600;
    quietPause = away;
    showMenu(!away);
  }, 150);
});

// M7 save and pause: Save, Load and Continue on the paper; the autosaves; Jef put back after a load (game/saves.ts)
function placeName(): string {
  if (landmarks.inside) return landmarks.inside.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  if (interiors.inside) return (interiors as unknown as { here?: { label?: string } | null }).here?.label ?? "indoors";
  let best = "Antwerp";
  let bestD = Infinity;
  for (const p of JUMPS) {
    const d = Math.hypot(p.x - player.x, p.z - player.z);
    if (d < bestD) (best = p.name), (bestD = d);
  }
  const places = (town.data?.places ?? {}) as Record<string, { x: number; z: number; label?: string }>;
  for (const [id, p] of Object.entries(places)) {
    if (!p.label || id.startsWith("home") || id.startsWith("work")) continue;
    const d = Math.hypot(p.x - player.x, p.z - player.z);
    if (d < bestD) (best = p.label), (bestD = d);
  }
  return bestD < 120 ? best : `near ${best}`;
}
function captureClient(): ClientState {
  const shown = Math.floor(jobs.day.hourF * 60 + 1e-6);
  return {
    v: 1,
    clock: { day: jobs.day.dayNum, hour: Math.floor(shown / 60) % 24, minute: shown % 60 },
    place: placeName(),
    pose: { x: +player.x.toFixed(3), z: +player.z.toFixed(3), y: +player.y.toFixed(3), yaw: +player.yaw.toFixed(4), pitch: +player.pitch.toFixed(4), swimming: player.swimming, crouching: player.crouching },
    row: rowing.snapshot(),
    jobs: jobs.snapshot(),
  };
}
/** Wait (real time) until `ok`, at most `ms`. */
async function until(ok: () => boolean, ms: number): Promise<boolean> {
  const end = real.now() + ms;
  while (!ok()) {
    if (real.now() > end) return false;
    await new Promise((r) => real.setTimeout(r, 100));
  }
  return true;
}
async function restoreClient(c: ClientState): Promise<void> {
  await world.city.ready.catch(() => {});
  // the boat puts Jef in it itself (game/rowing.ts); else he stands where he stood
  if (!c.row) player.restorePose(c.pose);
  const snap = c.jobs as JobSnap | undefined;
  if (snap && (await until(() => jobs.snapshotReady(snap), 20_000))) {
    // the handcart's own reload fix of laid-out goods first (game/handcart.ts), then ours
    await new Promise((r) => real.setTimeout(r, 600));
    jobs.restoreSnapshot(snap);
  }
  // again: a part that placed him while it loaded (the ferry, a home) does not win
  if (!c.row) player.restorePose(c.pose);
}
const saves = new Saves(startEl.querySelector(".paper") as HTMLElement, {
  capture: captureClient,
  restore: restoreClient,
  played: () => started,
  hour: () => (jobs.day.sheetOpen ? null : { day: jobs.day.dayNum, hour: jobs.day.hour }),
  playing: () => jobs.day.playing,
  say: (t) => jobs.say(t),
});
saves.showMenu(false);
{
  const c = bootRestore();
  const hint = startEl.querySelector(".hint");
  if (c && hint) hint.textContent = `Loaded${c.clock ? `: ${c.clock.hour}:${String(c.clock.minute).padStart(2, "0")}` : ""}${c.place ? `, ${c.place}` : ""}. Click, or press W, to go on.`;
}

/** Run one part of the frame; an error is logged once (by its message) and the rest of the frame goes on. */
const frameErrors = new Set<string>();
function safe(name: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    const key = `${name}: ${(e as Error)?.message ?? e}`;
    if (!frameErrors.has(key)) {
      frameErrors.add(key);
      console.error(`[frame] ${key}`, e);
    }
  }
}
// the people walking (and Jef's pushed cart) for the vehicles' and bridges' eyes: one list a
// frame, made before anything reads it (they read it a dozen times a frame)
let crowdNow: Array<{ x: number; z: number }> = [];
const folkNow: Array<{ x: number; z: number }> = [];
function refreshFolk(): void {
  crowdNow = crowd.positions();
  folkNow.length = 0;
  for (const q of crowdNow) folkNow.push(q);
  for (const q of handcarts.points()) folkNow.push(q);
}
const vehicleSounds: VehicleSound[] = [];
const timer = new THREE.Timer();
timer.connect(document);
let elapsed = 0;
let pausedDraw = 0;
/**
 * M7 quays: the goods heaps (world/quaygoods.ts) keep 2 m off every place of the paths() check. Those
 * places come in with the town (from the server) after the heaps may stand, so every few seconds, when
 * their number changed, any heap too near one is taken away. (Things that choose their place later,
 * the AI's ideas, a ferry's deck, choose it clear of the heaps themselves.)
 */
let goodsCheckAt = 0;
let goodsPoints = -1;
function quayGoodsKeepClear(): void {
  if (elapsed < goodsCheckAt || !quayGoodsInfo()) return;
  goodsCheckAt = elapsed + 4;
  const pts: Array<{ x: number; z: number; reach?: number }> = [
    ...Object.values(SPOTS),
    BOARD_POS,
    DOSS_POS,
    ...town.pathPoints(),
    ...deeds.pathPoints(),
    ...rowing.pathPoints(),
    ...trades.pathPoints(),
    ...steenLife.pathPoints(),
    ...interiors.pathPoints(),
    ...press.pathPoints(),
    ...townLife.pathPoints(),
    ...journeys.pathPoints(),
    ...emigrants.pathPoints(),
    ...homes.pathPoints(),
    ...landmarks.pathPoints(),
    ...carolus.pathPoints(),
    ...prison.pathPoints(), // M7 prison and squares
    ...townPlacePoints(),
    ...gothic.pathPoints(),
    ...ballads.pathPoints(),
    ...handcarts.pathPoints(),
    ...lively.pathPoints(),
    ...boxes.pathPoints(),
  ];
  if (pts.length === goodsPoints) return;
  goodsPoints = pts.length;
  const gone = pruneQuayGoods(pts, 2);
  if (gone) console.info(`[quaygoods] ${gone} heap(s) taken away: too near a place people need`);
}

function frame(): void {
  // the next frame first: an error below never stops the game (QA 2026-09-24: one throw froze it for good)
  requestAnimationFrame(frame);
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  // M7 save and pause: paused, nothing moves; the picture stands (drawn again now and then: a resize)
  if (pause.paused) {
    if (pausedDraw-- <= 0) {
      pausedDraw = 30;
      retro.render(world.scene, player.camera, elapsed);
    }
    return;
  }
  pausedDraw = 0;
  elapsed += dt;
  safe("refreshFolk", refreshFolk);
  safe("world.update", () => world.update(elapsed, dt, player.camera));
  safe("ferry.update", () => ferry.update(dt));
  safe("player.update", () => player.update(dt));
  safe("handcarts.update", () => handcarts.update(dt));
  safe("interiors.update", () => interiors.update(dt));
  safe("homes.update", () => homes.update(dt));
  safe("landmarks.update", () => landmarks.update(dt));
  safe("prison.update", () => {
    const d = landmarks.daylight();
    prison.update(elapsed, dt, jobs.day.dayNum, jobs.day.hourF, d.day, d.sky); // M7 prison and squares
  });
  safe("carolus.update", () => {
    const d = landmarks.daylight();
    carolus.update(elapsed, dt, jobs.day.hourF, d.day, d.sky);
    gothic.update(elapsed, dt, jobs.day.hourF, d.day, d.sky);
  });
  safe("interiors.sway", () => interiors.sway(dt));
  safe("jobs.update", () => jobs.update(dt));
  safe("boxes.update", () => boxes.update(elapsed));
  safe("night.update", () => night.update(dt));
  safe("craneClimb.update", () => craneClimb.update(dt));
  safe("crowd.setHour", () => crowd.setHour(jobs.day.hour));
  safe("crowd.update", () => crowd.update(dt, player, player.camera));
  safe("town.update", () => town.update(dt, player));
  safe("journeys.update", () => journeys.update(dt, player));
  safe("market.update", () => market.update(dt, player, jobs.day.dayNum, jobs.day.hourF));
  setLitterClock(jobs.day.dayNum, jobs.day.hourF);
  safe("trades.update", () => trades.update(elapsed, dt, player.camera, crowd.fogDistance));
  safe("steenLife.update", () => steenLife.update(dt, jobs.day.hourF, player.camera));
  safe("deeds.update", () => deeds.update(dt, jobs.day.hourF));
  safe("rowing.update", () => rowing.update(dt));
  safe("actions.update", () => actions.update(dt));
  safe("steps.update", () => steps.update(dt, routinesRun()));
  safe("hands.update", () => hands.update(dt, routinesRun()));
  safe("families.update", () => families.update(dt));
  safe("events.update", () => events.update(dt, player));
  safe("hearses.update", () => hearses.update(dt, player, events.list));
  safe("townLife.update", () => townLife.update(dt, player, jobs.day.hourF));
  safe("bubbles.update", () => bubbles.update(dt, player.camera));
  safe("ballads.update", () => ballads.update(dt, player.camera));
  safe("press.update", () => press.update(dt));
  safe("ideas.update", () => ideas.update(dt));
  safe("emigrants.update", () => emigrants.update(dt));
  safe("lively.update", () => lively.update(dt, player, player.camera, crowd.fogDistance));
  safe("backLife.update", () => backLife.update(dt, player)); // M7 back of town (hook)
  safe("quayGoods.keepClear", quayGoodsKeepClear);
  safe("animals.update", () => animals.update(dt, player, player.camera, crowd.fogDistance, jobs.day.hour >= 19 || jobs.day.hour < 7));
  safe("alive.update", () => alive.update(elapsed, dt, player.camera, { day: jobs.day.dayNum, hour: jobs.day.hourF }, weatherNow)); // M7 alive (hook)
  // the murmur follows the people near Jef, not everyone in view (audio/soundscape.ts setCrowdAround)
  safe("sound.setCrowd", () => sound?.setCrowdAround(crowd.positions()));
  // talk in a tavern, the cellar or a hall follows the people in it: none alone, more with more (Steve 2026-09-25)
  safe("sound.people", () => {
    const p = interiors.people;
    sound?.setPlacePeople(p?.place ?? null, p?.n ?? 0);
    sound?.setRoomPeople(interiors.inside ? (p?.n ?? 0) : landmarks.indoors ? landmarks.peopleInside : null);
  });
  safe("sound.setRain", () => sound?.setRain(psxUniforms.uRain.value));
  safe("sound.update", () => sound?.update(player.camera));
  safe("vehicles and people wiring", () => {
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
    if (sound && (tr || rail || bus || deeds.velos.ridden)) {
      // one reused list (the drays' own light list, not their dev readout)
      vehicleSounds.length = 0;
      tr?.sounds(vehicleSounds);
      for (const q of rail?.vehicles() ?? []) vehicleSounds.push(q);
      for (const q of bus?.vehicles() ?? []) vehicleSounds.push(q);
      for (const q of deeds.velos.sounds()) vehicleSounds.push(q);
      for (const q of handcarts.sounds()) vehicleSounds.push(q);
      sound.setVehicles(vehicleSounds);
    }
  }
  {
    // the goods train and the omnibus stop for the people walking in front of them
    const rail = world.railway();
    // (M6 handcart: and for the cart Jef pushes; the drays of the quay traffic too)
    if (rail && !rail.people) rail.people = () => folkNow;
    const trf = world.traffic();
    if (trf && !trf.people) trf.people = () => folkNow;
    if (!peopleWired) {
      // bridges never open under anyone walking
      world.setPeople(() => crowdNow);
      peopleWired = true;
    }
    const bus = world.omnibus();
    if (bus && !bus.people) bus.people = () => folkNow;
    // M6 transport: the town's own people ride the omnibus (no fare), and step off at their stop
    if (bus && !bus.onResidentOff) bus.onResidentOff = (_b, id, at) => journeys.offBus(id, at);
    // M7 omnibus routes: the timetable runs by the game clock (shared/omnibusLines.ts)
    if (bus && !bus.clock) bus.clock = () => ({ day: jobs.day.dayNum, hour: jobs.day.hourF });
  }
  });
  safe("lanternLights.update", () => {
    lanternLights.update(dt, player.camera, lanternDark());
  });
  // M7: every room stands in the world now (world/inworld.ts draws it through its openings)
  retro.render(world.scene, player.camera, elapsed);
  }
requestAnimationFrame(frame);

// Warm-up: once the city is in, send every house chunk and landmark to the GPU
// and build every shader now, not the first time you walk up to them (that was
// the stutter).
world.city.ready.then(() => {
  const hidden: THREE.Object3D[] = [];
  // M7: each mesh gets its own frustumCulled back (it was set true on all, also on those that must not be culled)
  const culled = new Map<THREE.Object3D, boolean>();
  world.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
      culled.set(o, o.frustumCulled);
      o.frustumCulled = false;
    }
  });
  renderer.compile(world.scene, player.camera);
  // M7: the warm-up draws everything, so the culler stands aside for it
  const culling = cull.enabled;
  cull.enabled = false;
  retro.render(world.scene, player.camera, elapsed);
  cull.enabled = culling;
  for (const [o, f] of culled) o.frustumCulled = f;
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
    journeys,
    actions,
    events,
    townLife,
    hearses,
    bubbles,
    interiors,
    families,
    homes,
    landmarks,
    /** M7: interiors in the world (world/inworld.ts): plan(camera), visibility(), enabled. */
    inWorld,
    /** M7 Carolus: the church in the world (world/carolusHall.ts). */
    carolus,
    /** M7 prison and squares: the prison (world/prisonHall.ts). */
    prison,
    /** M7 Paul and James: St Paul's and St James's in the world (world/gothicHall.ts). */
    gothic,
    ballads,
    handcarts,
    steps,
    hands,
    lively,
    /** M7 ferry arrival: info(true) shows the deck, devIdle(s) skips the ferryman's patience. */
    ferry,
    /** M7 night: the quest boxes (info()), the gangs (info(), answer(how)). */
    boxes,
    night,
    /** M6 handcart: where a dray, a handcart or an omnibus round touches a wall or a fixed thing (should be []). */
    routeClips: () => routeClips(world, []),
    /** Clutter: the street ends at the water or the map edge still open (should be []); `all` lists every end and how it is closed. */
    streetEnds: (all = false) => streetEndCheck(all),
    /** Clutter: what was placed, and the alleys found (through or dead end, props, closure). */
    clutter: () => clutterInfo(),
    /** M7 quays: the goods heaps (info()), every model in a row for close pictures (showroom(x, z)), a map of them (map(...) saved as a shot). */
    quayGoods: {
      info: () => quayGoodsInfo(),
      why: quayGoodsWhy,
      keepAt: quayGoodsKeepAt,
      showroom: (x: number, z: number, names?: string[]) => quayGoodsShowroom(world.scene, x, z, names),
      map: async (name: string, x0: number, z0: number, x1: number, z1: number, px = 4) => {
        const url = quayGoodsMap(x0, z0, x1, z1, px);
        if (!url) return "not built yet";
        const r = await fetch("/api/dev/shot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, url }) });
        return r.ok ? `data/shots/${name}.jpg` : `shot failed ${r.status}`;
      },
    },
    /** Every sign, plate, number and bill on the house walls: off its wall, past a corner, over a window or door, or overlapping another (should list nothing). */
    signs: () => {
      const sl = world.streetLife();
      return sl ? checkSigns(world.scene, world.city.group, sl) : "street life not loaded yet";
    },
    /** M7 posters: every bill on the walls and every place for the engine's bills, against the houses as built (dev/postercheck.ts; should list nothing). */
    posters: async () => {
      const sl = world.streetLife();
      const p = world.posters();
      return sl && p ? (await import("./dev/postercheck")).checkPosters(world.city.group, world.city.flags, sl, p, undefined, world.scene) : "the bills are not up yet";
    },
    /** Z-fight check (dev/zfight.ts): faces of the static world in one plane that overlap, and layers too close to their surface, by cause (M3c pass 5). */
    zfight: async (opts = {}) => (await import("./dev/zfight")).checkZFight(world.scene, world.city.flags, opts),
    /** M7 halls: the checks of the halls in the world (dev/hallcheck.ts): pictures, the walk through a door (pops), holes in a hall. */
    halls: async () => {
      const d = (window as unknown as { __scheldemist: { step(s: number): void; shot(n: string): Promise<string> } }).__scheldemist;
      return (await import("./dev/hallcheck")).makeHallCheck({ halls: () => landmarks.inWorldHalls, player, world, inWorld, renderer, render: (cam, t) => retro.render(world.scene, cam, t), update: (dt) => d.step(dt), shot: (n) => d.shot(n) });
    },
    /** M7 taverns and homes: the halls' checks (walk, gaps, shot) for the in-world houses, by id ("tavern:ankere", "home:garret"). */
    houses: async () => {
      const d = (window as unknown as { __scheldemist: { step(s: number): void; shot(n: string): Promise<string> } }).__scheldemist;
      // a house in the world has what the checks read of a hall: its id, its plan (a HallPlan) and its frame
      const all = () => [...interiors.inWorldHouses, ...homes.inWorldHouses] as unknown as typeof landmarks.inWorldHalls;
      return (await import("./dev/hallcheck")).makeHallCheck({ halls: all, player, world, inWorld, renderer, render: (cam, t) => retro.render(world.scene, cam, t), update: (dt) => d.step(dt), shot: (n) => d.shot(n) });
    },
    /** M6: a picture inside the room of the tavern or home near Jef, camera at `from` looking at `to` (room frame: x across, y up, z into the house). */
    async shotIn(name: string, from: [number, number, number], to: [number, number, number]) {
      const cam = player.camera;
      const keep = { p: cam.position.clone(), q: cam.quaternion.clone() };
      if (!interiors.devCamera(cam, from, to)) return "not inside";
      retro.render(world.scene, cam, elapsed);
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
      retro.render(world.scene, player.camera, elapsed);
      return ideas.pageShot(name, canvas);
    },
    emigrants,
    get sound() {
      return sound;
    },
    free(on = true) {
      player.freeInput = on;
      startEl.classList.toggle("hidden", on);
      if (on) started = true;
      if (on && !sound) start();
      syncPause();
    },
    /** M7 save and pause: the pause (game/pause.ts; `real`: its untouched timers, for waiting through a pause) and the saves (game/saves.ts). */
    pause,
    real,
    saves,
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
      // M6 transport: where velocipedes and handcarts stand, the errands' ends, the velocipede maker
      for (const q of journeys.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
      // M6: the Logement door, the emigrants' places on the quay, the Red Star Line notice
      for (const q of emigrants.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
      // M6 homes: every home's door and the second-hand dealer
      for (const q of homes.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
      // M7 taverns and homes: inside the houses by their own plans (world/houseInWorld.ts)
      bad.push(...interiors.insidePathProblems(), ...homes.insidePathProblems());
      // M6 landmark interiors: every landmark door
      for (const q of landmarks.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
      // M7 Carolus: inside the church, while its door stands open
      for (const q of carolus.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
      // M7 prison and squares: inside the prison while its gate stands open; the square's and the greens' benches
      for (const q of [...prison.pathPoints(), ...townPlacePoints()]) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
      // M7 Paul and James: inside St Paul's and St James's, while their doors stand open
      for (const q of gothic.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
      // M6 ballads: the ballad singer's corners
      for (const q of ballads.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
      // M6 handcart: the wheelwright's door and his carts
      for (const q of handcarts.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
      // M6 lively: the stalls against the cathedral, the Madonnas' stands, the beggars' places, every stop of a round
      for (const q of lively.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
      // M7 ferry arrival: while the ferry lies at the pontoon, Jef's place on her deck
      for (const q of ferry.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
      // M7 night: every employer's quest box by his door
      for (const q of boxes.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
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
        lanternLights.redraw();
        retro.render(world.scene, player.camera, elapsed);
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
      // M7 save and pause: a paused game does not move for the kit either
      if (pause.paused) return;
      const dt = 1 / 60;
      // M7 omnibus routes: the omnibuses keep the timetable in the kit's runs too (the frame sets this hook as well)
      const bus = world.omnibus();
      if (bus && !bus.clock) bus.clock = () => ({ day: jobs.day.dayNum, hour: jobs.day.hourF });
      if (bus && !bus.eye) bus.eye = () => player.camera.position;
      for (let t = 0; t < seconds; t += dt) {
        elapsed += dt;
        world.update(elapsed, dt);
        ferry.update(dt);
        player.update(dt);
        handcarts.update(dt);
        interiors.update(dt);
        homes.update(dt);
        landmarks.update(dt);
        {
          const d = landmarks.daylight();
          carolus.update(elapsed, dt, jobs.day.hourF, d.day, d.sky);
          gothic.update(elapsed, dt, jobs.day.hourF, d.day, d.sky);
          prison.update(elapsed, dt, jobs.day.dayNum, jobs.day.hourF, d.day, d.sky); // M7 prison and squares
        }
        jobs.update(dt);
        boxes.update(elapsed);
        night.update(dt);
        crowd.setHour(jobs.day.hour); // (as the frame does: the crowd's hour, its lanterns after dark)
        crowd.update(dt, player, player.camera);
        town.update(dt, player);
        journeys.update(dt, player);
        market.update(dt, player, jobs.day.dayNum, jobs.day.hourF);
        setLitterClock(jobs.day.dayNum, jobs.day.hourF);
        trades.update(elapsed, dt, player.camera, crowd.fogDistance);
        steenLife.update(dt, jobs.day.hourF, player.camera);
        deeds.update(dt, jobs.day.hourF);
        rowing.update(dt);
        actions.update(dt);
        steps.update(dt, routinesRun());
        hands.update(dt, routinesRun());
        families.update(dt);
        events.update(dt, player);
        hearses.update(dt, player, events.list);
        townLife.update(dt, player, jobs.day.hourF);
        bubbles.update(dt, player.camera);
        ballads.update(dt, player.camera);
        press.update(dt);
        ideas.update(dt);
        emigrants.update(dt);
        lively.update(dt, player, player.camera, crowd.fogDistance);
        backLife.update(dt, player); // M7 back of town (hook)
        animals.update(dt, player, player.camera, crowd.fogDistance, jobs.day.hour >= 19 || jobs.day.hour < 7);
        alive.update(elapsed, dt, player.camera, { day: jobs.day.dayNum, hour: jobs.day.hourF }, weatherNow); // M7 alive (hook)
        lanternLights.update(dt, player.camera, lanternDark());
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
  // the test kit (docs/testing.md): __scheldemist.t.help()
  const dev = (window as unknown as { __scheldemist: { step(s: number): void; shotFrom(n: string, f: [number, number, number], t: [number, number, number], fog?: number): Promise<string>; t?: unknown } }).__scheldemist;
  dev.t = makeTestKit({
    player,
    world,
    town,
    jobs,
    events,
    boxes,
    night,
    step: (s) => dev.step(s),
    shotFrom: (n, f, t, fog) => dev.shotFrom(n, f, t, fog),
    audio: () => sound as unknown as { ctx: BaseAudioContext } | null,
    // M7 save and pause
    pauseGame: (on) => keyPause(on),
    pauseState: () => ({ paused: pause.paused, reasons: pause.reasons, pausedMs: Math.round(pause.pausedMs), card: pauseCard.style.display !== "none", audio: sound?.state ?? "none" }),
    saves,
    capture: captureClient,
  });
}

// M7 rendering, dev: the culler and the renderer for checks (__scheldemist.cull), and the view's numbers
if (import.meta.env.DEV) {
  Object.assign((window as unknown as { __scheldemist: object }).__scheldemist, { cull, renderer, retro, lanternLights, alive });
  // M7 back of town (hook): __scheldemist.back.info(), .at(place)
  Object.assign((window as unknown as { __scheldemist: object }).__scheldemist, { back: backLife });
  mountCullHud(cull);
}

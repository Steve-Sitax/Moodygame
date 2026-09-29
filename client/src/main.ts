// menus: the key bindings and the menu's keys, before every other key listener (menu/keys.ts)
import "./menu/keys";
// M7 save and pause: first of all, so the pause clock is in place before any other part runs (game/pause.ts)
import { onPausedKey, passKeys, pause, real } from "./game/pause";
import { drawAudit, pixelDiff, prof, profTable, pt, quantiles } from "./dev/frameProf";
import { uniformCache } from "./retro/uniformCache";
import { matrixSkip } from "./retro/matrixSkip";
import { mirrorView } from "./world/mirror";
import { materialShare, staticMerge } from "./world/staticMerge";
import { routeStats } from "../../server/src/town/whereabouts";
// boot: the loading screen's numbers (boot/probe.ts): from the first moment on
import { bootMark, bootNote, bootProbe } from "./boot/probe";
// boot: the loading screen (boot/loader.ts): counts the files from here on, holds keys and clicks until the menu is up
import { booting, finishBoot, runBoot } from "./boot/loader";
import { dialogs } from "./game/dialogs";
import { InkCursor, sendKey } from "./game/cursor";
import * as THREE from "three";
import "./style.css";
// menus: the game's own fonts; the town's canvases are painted after they are in (menu/fonts.ts)
import "./menu/fonts";
import { RetroPass } from "./retro/retroPass";
import { psxUniforms } from "./retro/psx";
import { mountSettings, STREET_LEVELS, type GameSettings } from "./game/settings";
import { wireSettings } from "./menu/apply"; // menus
import { settings as prefs } from "./game/prefs";
import { mountDevMenu } from "./game/devmenu";
import { DEMO } from "./demo/demo";
import { setAmbientViewHeight } from "./world/ambient";
import { setFireViewHeight } from "./world/fire";
import { setWallTown } from "./world/wallLife";
import { rampartStairAt } from "./world/rampart";
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
import { createSpill, setSpillBudget, spillBudget } from "./world/spill";
import { L_HOLD, ShaderWarmer } from "./world/warmup";
import { FirstPerson } from "./player/firstPerson";
// M7 character: the player's profile and the body dressed from it (player/profile.ts, player/body.ts)
import { PlayerBody } from "./player/body";
import { loadProfile } from "./player/profile";
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
import { clockReport, setClockHands } from "./world/clockHands"; // every clock shows the game's time (Steve 2026-09-26)
import { clutterInfo, streetEndCheck } from "./world/clutter";
import { pruneQuayGoods, quayGoodsInfo, quayGoodsMap, quayGoodsShowroom, quayGoodsWhy, quayGoodsKeepAt } from "./world/quaygoods";
import { createTrades } from "./world/trades";
import { runsNow } from "../../server/src/town/runs"; // T1: the town's runs by the engine's sums (the dev check)
import { createSteenLife } from "./world/steenlife";
import { Actions } from "./game/actions";
import { Hearses } from "./game/hearses";
import { Bubbles } from "./game/bubbles";
import { Events } from "./game/events";
import { TownLife } from "./game/townlife";
import { Press } from "./game/press";
import { Ideas } from "./game/ideas";
import { Walkup, walkupHooks } from "./game/walkup";
import { PopWatch } from "./dev/popcheck";
import { stuckCheck } from "./dev/stuckcheck";
import { Emigrants } from "./game/emigrants";
import { api } from "./net/api";
import { Interiors } from "./game/interiors";
import { tempest } from "./world/tempest";
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
// M7 mills (docs/milestones/M7-mills.md): the millers, the sails in the wind, the flour and grain carts, the mill work (hook)
import { Mills } from "./game/mills";
import { ParkWork } from "./game/parkWork";
import { parkLife } from "./world/parkWildlife";
import { LampJob } from "./game/lampjob";
import { setAliveViewHeight } from "./world/alive/common";
import { bootRestore, type ClientState } from "./game/restoreData";
import { Together } from "./net/mp/together"; // M8a multiplayer: the others in the town, no pause together
import { gearModel } from "./net/mp/gear"; // M8b: the others' boats, velocipedes and handcarts
import { cartSub, handcartFrame } from "./game/goods"; // M8f goods pass 2: another player's handcart load
import { isGuest } from "./net/mp/identity";
import { GEAR } from "../../shared/mpProtocol";
import { SMALL_KINDS } from "../../shared/smallBoats";
import type { JobSnap } from "./game/jobs";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const startEl = document.getElementById("start") as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(1);

const world = buildRijnkaai();
// carried lanterns light the world: a pool of real lights (the nearest throws shadows), ground pools
// for the rest (world/lanternLights.ts). Made before any shader is built: it switches shadows on.
const lanternLights = new LanternLights(world.scene, renderer, (x, z, feet) => world.groundAt(x, z, 0, feet));
// light spilt from lit windows, doors, lamps and lanterns onto the ground, the walls and the people (world/spill.ts)
// (the ground under a light: where the walk map stops short of a wall, the street's own level there; the water a drop)
const spill = createSpill(
  world.scene,
  (x, z, feet) => world.groundAt(x, z, 0, feet),
  (x, z) => (world.isWater(x, z) ? -8 : world.baseAt(x, z)),
  // (a pool laid before a doorstep or a kerb came in is laid again: issue #6)
  () => world.solidsVersion(),
);
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
// dev: where the merged still parts are looked for by the A/B switch (world/staticMerge.ts)
staticMerge.roots = () => [world.scene, ...inWorld.all.map((r) => r.scene)];
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
    // (the look pass: the wall's stairs are narrower than a walker's berth; up them all the same)
    narrow: rampartStairAt,
    // Steve 2026-09-27: smaller gives way to bigger; the train and the omnibus are not held up (crowd.ts giveWay)
    vehicles: () => {
      const out: Array<{ r: { minX: number; maxX: number; minZ: number; maxZ: number }; rank: number }> = [];
      for (const r of world.railway()?.rolling() ?? []) out.push({ r, rank: 3 });
      for (const r of world.omnibus()?.rolling() ?? []) out.push({ r, rank: 2.5 });
      for (const r of world.traffic()?.colliders() ?? []) out.push({ r, rank: 2 });
      return out;
    },
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
// D1 docks: the dockers lift the loads of their routes' piles for real and set them down at the other end
town.docks = {
  lift: (npc, route) => jobs.goods.haulLift(npc, route)?.id ?? null,
  putIn: (npc, id) => jobs.goods.haulIn(npc, id),
};
setWallTown((x, z, r) => town.inStreet(x, z, r)); // (the look pass: the kite on the wall flies from a child's hand, world/wallLife.ts)
// M3i: market days on the Vismarkt and the Grote Markt (game/market.ts), and the working
// trades: boat yard, farrier, rope walk, cooper, sailmaker, net menders (world/trades.ts)
const market = new Market(world, crowd, town, stalls);
// T3 trade: the Vismarkt's fishwives pack up early when the fish is sold out (shared/trade.ts post "vismarkt")
market.soldOutOf = (place) => place === "vismarkt" && town.soldOut("vismarkt");
town.market = market;
animals.scraps = market.scrapSpots();
const trades = createTrades(world.scene, world.city.flags, { clock: () => ({ day: jobs.day.dayNum, hour: jobs.day.hourF }) });
// visitors at the Steen (the Museum of Antiquities), the attendant, a painter, an angler (world/steenlife.ts)
const steenLife = createSteenLife(world.scene, crowd);
// M7 alive (hook): leaves in the wind, birds, bats, moths, drips, mist, buoys, thunder (world/alive/)
const alive = createAlive(world.scene, world, () => sound);
/** The room the great storm's rain was last fitted round (world/tempest.ts roomBox). */
let stormRoom: import("./world/rooms").Room | null = null;
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
{
  // the paper map and the corner map: what goes on in town (game/map.ts)
  const marks = jobs.map.marks;
  jobs.map.marks = () => [...marks(), ...events.mapMarks(player)];
}
const bubbles = new Bubbles(town);
const actions = new Actions(world, player, town, crowd, events);
// M7 funeral: the hearse of a funeral's departure (game/hearses.ts); the column walks after it
const hearses = new Hearses(world, town);
actions.hearses = hearses;
actions.say = (t) => jobs.say(t);
// the great storm (world/tempest.ts): a line as it comes, breaks and goes
tempest.onPhase = (p, was) => {
  if (p === "coming") jobs.say("The sky goes black over the Schelde. A great storm is coming in off the sea: the shops put up their shutters, and people run for cover.");
  else if (p === "peak") jobs.say("The storm breaks. Rain in sheets, slates off the roofs. Nobody gives out work in this: get under a roof.");
  else if (p === "easing") jobs.say("The great storm begins to blow itself out.");
  else if (was) jobs.say("The storm has blown over. A steady rain is left; the shops take down their shutters.");
};
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
// M7 walk-up: job and quest people come from the living town and walk up (game/walkup.ts); the popcheck watches (dev/popcheck.ts)
const walkup = new Walkup(world, player, town, crowd);
const popWatch = new PopWatch(crowd, town, player, () => actions.active.map((a) => a.npc));
crowd.onFrame = () => {
  popWatch.frame();
  walkup.tick();
};
// M6 AI ideas: bills on the walls, letters of your own, trouble on a job, lost things and notebooks (game/ideas.ts)
const ideas = new Ideas(world, player, jobs, town, press);
walkupHooks.trouble = () => void ideas.load();
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
const ferry = new FerryArrival({ world, player, say: (t) => jobs.say(t), path: (ax, az, bx, bz) => crowd.pathOn(ax, az, bx, bz), dark: lanternDark });
events.eventCues = (cues, at, s) => sound?.eventCues(cues, at, s) ?? null;
events.say = (t) => jobs.say(t);
// M6 town life: the lamplighters, the house fire and its bucket chain, the naties' hiring at dawn (game/townlife.ts)
const townLife = new TownLife(world, town, crowd, events);
townLife.say = (t) => jobs.say(t);
townLife.fogDay = () => jobs.day.lampsFog;
townLife.lampsHelp = () => jobs.day.lampsHelp;
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
// M7 character: the player's body in the world (the reflections and a lantern's shadow see it; the eye sees
// the forearms: hands.ts, lantern.ts), dressed from the profile the server keeps
const meBody = new PlayerBody(world.scene, player);
void loadProfile();
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
// M7 mills (hook): the millers on the wall, the sails in the wind, the flour cart at dawn and the grain after dinner (game/mills.ts)
const mills = new Mills(world, town, crowd);
town.mills = mills.hook();
mills.clock = () => ({ day: jobs.day.dayNum, hour: jobs.day.hourF });
mills.weather = () => weatherNow ?? "clear";
mills.say = (t) => jobs.say(t);
mills.load().catch((e) => console.warn("the mills did not load", e));
// the lamplighter's last lamps, a job for Jef at dusk (game/lampjob.ts; server town/lampjob.ts)
const lampJob = new LampJob(world);
lampJob.hour = () => jobs.day.hourF;
// M7 night: the employers' quest boxes by their doors (game/questboxes.ts), and the gangs (game/nightlife.ts)
const parkWork = new ParkWork(world, player, jobs, town, crowd, animals);
parkLife.boats = () => { const r = rowing.info(); return [...r.lying, ...(r.rowing ? [{ x: r.x, z: r.z }] : [])]; };
const boxes = new QuestBoxes(world, jobs.people, town);
boxes.clock = () => ({ day: jobs.day.dayNum, hour: jobs.day.hourF });
jobs.boxes = boxes;
const night = new Nightlife(world, player, jobs, town);
night.indoors = () => interiors.inside || landmarks.indoors || carolus.indoors || gothic.indoors || prison.indoors;
// M7 warmth: where Jef is and whether his lantern is lit go with each tick; the server checks both (server/src/warmth.ts)
jobs.day.where = () => {
  const lantern = deeds.lantern.lit;
  const room = interiors.placeId;
  if (room) return { at: room.startsWith("tavern:") || room.startsWith("shop:") || room === "poesje" ? room : `home:${room}`, lantern };
  const hall = landmarks.indoors ? landmarks.inside : null;
  if (hall) return { at: `landmark:${hall}`, lantern };
  if (carolus.indoors) return { at: "church:carolus", lantern };
  if (gothic.indoors) return { at: "church:gothic", lantern };
  if (prison.indoors) return { at: "prison", lantern };
  return { at: null, lantern };
};
{
  const onPush = jobs.onPush;
  jobs.onPush = (m) => {
    onPush(m);
    night.handlePush(m);
  };
}
void night.load();
{
  // M8e review 4: the push socket came back after a drop (net/api.ts connectPush; the job board is asked for there):
  // what was pushed meanwhile is lost, so the parts that keep their own state ask the server again, as a push of
  // their kind would make them (the actions and events, the hired hands' steps, the ballads, the ideas, the
  // emigrants, the paper, a gang in the street)
  const onPush = jobs.onPush;
  jobs.onPush = (m) => {
    onPush(m);
    if (m.type !== "resync") return;
    actions.handlePush({ type: "events" });
    townLife.handlePush({ type: "events" });
    hands.handlePush({ type: "actions" });
    void ballads.load();
    void ideas.load();
    void emigrants.refresh();
    void press.load();
    void night.load();
  };
}
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

/** Paused: the picture wants drawing again (a resize, a setting changed). The menu first: see MENU_QUIET_MS. */
let standDirty = false;
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
  standDirty = true;
}
window.addEventListener("resize", resize);
// the settings (Esc: the pause paper has a Settings button); applying them resizes
let settings: GameSettings = { height: 720, psxColour: true, wobble: false, street: "normal" };
settings = mountSettings(startEl.querySelector(".paper") as HTMLElement, (s) => {
  settings = s;
  retro.renderHeight = s.height;
  retro.setPsxColour(s.psxColour);
  town.maxPuppets = STREET_LEVELS[s.street].cap; // M6 population: people in the street
  crowd.setStressMultiplier(crowd.stress.multiplier, town.maxPuppets);
  resize();
});
/**
 * The web demo's event buttons (Steve 2026-09-27: "make it all available"): demo/demo.ts plays each event back as it
 * was recorded when the demo was built, at its own hour; Jef is put on free ground near it, facing it.
 */
function demoEvents(): Array<{ label: string; run: () => Promise<string> }> {
  const all = ["musicians", "fish_auction", "quarrel", "scuffle", "house_fire", "hiring", "wedding", "funeral", "emigrant_ship", "street_robbery", "tavern_brawl", "night_watch", "burglary", "smuggling", "tempest"];
  return all.map((t) => ({
    label: `Event: ${t.replace(/_/g, " ")}`,
    run: () =>
      api
        .devDirector({ template: t })
        .then((r) => {
          if (!r.ok) return `not here: ${String(r.why ?? "")}`;
          const x = Number(r.x);
          const z = Number(r.z);
          if (Number.isFinite(x) && Number.isFinite(z))
            for (const d of [10, 14, 18, 24, 7])
              for (let k = 0; k < 12; k++) {
                const a = (k * Math.PI) / 6;
                const px = x + Math.sin(a) * d;
                const pz = z + Math.cos(a) * d;
                if (!world.isFree(px, pz, 0.35) || world.isWater(px, pz)) continue;
                player.place(px, pz, Math.atan2(x - px, z - pz) - Math.PI, 0);
                return `${String(r.title)} at ${String(r.where)}: it starts now, right in front of you. Close this and watch.`;
              }
          if (t === "tempest") return `${String(r.title)}: it comes now, over the whole town. Close this and stay outside.`;
          return `${String(r.title)} at ${String(r.where)}: it starts now.`;
        })
        .catch((e) => String(e)),
  }));
}

// dev builds: a Dev button next to Settings (time, weather, events, jump to places); the web demo too, without
// the parts that need the server (demo/demo.ts answers the time and the weather)
if (import.meta.env.DEV || DEMO) {
  mountDevMenu(startEl.querySelector(".paper") as HTMLElement, {
    place: (x, z) => player.place(x, z, 0),
    tide: world.tideDev,
    population: { read: () => crowd.stress, set: (n) => crowd.setStressMultiplier(n, town.maxPuppets) },
    places: JUMPS,
    events: DEMO ? [...world.devEvents(), ...demoEvents()] : [
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
      ...["wedding", "funeral", "musicians", "emigrant_ship", "fish_auction", "quarrel", "scuffle", "street_robbery", "house_fire", "tempest", "hiring", "tavern_brawl", "burglary", "smuggling", "night_watch"].map((t) => ({
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
  // focus fix (2026-09-26): a dialog up (a talk, a card): back into it at once, whether the mouse lock
  // comes now, a moment later or not at all (the browser may refuse it); the lock is asked for below
  if (started && dialogs.any()) {
    dialogPlay = true;
    quietPause = false;
    startEl.classList.add("hidden");
    resumeEl.classList.add("hidden");
    saves.closePanel();
    syncPause();
  }
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
/**
 * Focus fix (2026-09-26): back in a dialog without the mouse lock (it is asked for, and comes a moment later
 * or never): the game plays while the dialog is up. Cleared when the lock comes, the window is left or the
 * dialog closes (then the quiet pause, as after going away).
 */
let dialogPlay = false;
/** The game has the player's input: the mouse lock, the dev's free input, or a dialog gone back to. */
const hasInput = () => player.locked || player.freeInput || (dialogPlay && dialogs.any());
const hintEl = startEl.querySelector(".hint");
const hintText = hintEl?.textContent ?? "";
function showMenu(on: boolean): void {
  // once in the game, the paper says how to go on (a loaded save's line was for the first screen)
  if (on && started && hintEl) hintEl.textContent = hintText.replace("to walk", "to go on");
  startEl.classList.toggle("hidden", !on);
  resumeEl.classList.toggle("hidden", on || hasInput() || !quietPause || pause.has("key"));
  // focus fix: with a dialog up, any key goes back to it
  resumeEl.textContent = dialogs.any() ? "Click or press any key to go on · Esc: menu" : "Click or press W to go on · Esc: menu";
  stamp.style.display = started && on ? "" : "none";
  if (on) saves.showMenu(started);
  else saves.closePanel();
  syncPause();
}
/** The menu reason: entered once, and the menu is up or the game does not have the mouse (the dev's free input has it). */
function syncPause(): void {
  pause.set("menu", started && (!startEl.classList.contains("hidden") || !hasInput()));
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
/** Keys that never go back into the game from the quiet pause: a lone modifier, the print key, a shortcut. */
const NOT_BACK = /^(Alt|Control|Shift|Meta|OS|Tab|PrintScreen|CapsLock|NumLock|ScrollLock|ContextMenu|F\d+)/;
/**
 * Keys on the menu, the card, a panel: before the game is entered, and (game/pause.ts) while paused.
 * True: the game plays again and the key goes on to it (a dialog's key after coming back to the window).
 */
function menuKey(e: KeyboardEvent, typing: boolean): boolean {
  if (e.repeat) return false;
  if (pause.has("saving") || pause.has("loading")) return false; // wait for it
  // focus fix (2026-09-26): back at the window with a dialog up (a talk, a card): any key goes back into
  // the game; the dialog's own keys (a digit, E, B, the letters in its input) reach it, the walking keys only go on
  if (e.code !== "Escape" && quietPause && started && !pause.has("key") && startEl.classList.contains("hidden") && !panelsOpen().length && dialogs.any()) {
    if (NOT_BACK.test(e.code) || e.ctrlKey || e.altKey || e.metaKey) return false;
    start();
    if (typing || !RESUME_KEYS.includes(e.code)) return true;
    e.preventDefault();
    return false;
  }
  if (e.code === "Escape") {
    e.preventDefault();
    // a panel open (Settings, Save, Load, Dev): Esc closes it
    const open = panelsOpen();
    if (open.length) {
      for (const p of open) p.style.display = "none";
      return false;
    }
    if (pause.has("key")) {
      // from the card to the menu (the menu's pause first: no moment of play between them)
      pauseCard.style.display = "none";
      quietPause = false;
      showMenu(true);
      pause.set("key", false);
      return false;
    }
    const menuOpen = !startEl.classList.contains("hidden");
    quietPause = menuOpen;
    showMenu(!menuOpen);
    return false;
  }
  if (typing) {
    // Enter in a save's name: save there
    if (e.code === "Enter") (e.target as HTMLElement).closest("li")?.querySelector<HTMLButtonElement>("button[name=go]")?.click();
    return false;
  }
  if (panelsOpen().length) return false;
  if (e.code === "KeyP" && pause.has("key")) {
    e.preventDefault();
    keyPause(false);
    return false;
  }
  if (RESUME_KEYS.includes(e.code)) {
    e.preventDefault();
    if (pause.has("key")) keyPause(false);
    else start();
  }
  return false;
}
onPausedKey(menuKey);
window.addEventListener("keydown", (e) => {
  // P in the game: the pause (the gang's and the menace's own P go first: they stop the key)
  if (e.code === "KeyP" && !e.repeat && hasInput() && !pause.paused && !jobs.day.sheetOpen && !pause.together) { // M8a: no pause together
    const t = document.activeElement as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
    e.preventDefault();
    keyPause(true);
    return;
  }
  if (hasInput()) return;
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
// the mouse in the dialogs (Steve 2026-09-26): an ink cursor while one is up, the lock kept; a click on a
// line or a key there does what the key does (game/cursor.ts). A click on a line from the quiet pause goes on first.
const ink = new InkCursor(player, () => {
  if (quietPause && startEl.classList.contains("hidden") && !pause.has("key")) start();
});
player.mouseHeld = () => ink.active;
// focus fix (2026-09-26): with a dialog up, a click on it (not only on the picture) goes back into the game
window.addEventListener("click", (e) => {
  if (!quietPause || pause.has("key") || !dialogs.any() || !startEl.classList.contains("hidden")) return;
  const el = e.target as HTMLElement | null;
  if (el === canvas || el?.closest?.("#start, .settings, .pause-ui")) return;
  start();
});
let lostFocusAt = -1e9;
window.addEventListener("blur", () => (lostFocusAt = real.now()));
// focus fix: in a dialog without the lock, leaving the window pauses as losing the lock does; the dialog
// closed without the lock: the quiet pause (a click or W goes on, and takes the mouse)
function leaveDialogPlay(): void {
  if (!dialogPlay) return;
  dialogPlay = false;
  if (player.locked || player.freeInput || pause.has("key")) return;
  quietPause = true;
  showMenu(false);
}
window.addEventListener("blur", leaveDialogPlay);
setInterval(() => {
  if (dialogPlay && !dialogs.any()) leaveDialogPlay();
}, 100);
document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === canvas;
  dialogPlay = false; // focus fix: the lock came (the usual rules again), or went: the pause as ever
  if (locked || player.freeInput) {
    started = true;
    quietPause = false;
    startEl.classList.add("hidden");
    resumeEl.classList.add("hidden");
    saves.closePanel();
    syncPause();
    return;
  }
  // Steve 2026-09-29 ("esc to exit instead of only map key"): the browser keeps the Esc that lets the mouse
  // go; with a dialog up that Esc closes (the map, a talk, the book), it is sent on to the dialog below
  const escDialog = dialogs.escapable();
  // at once: nothing moves from the moment the mouse is let go
  syncPause();
  // P: the card is up, not the menu
  if (pause.has("key")) return;
  // the mouse was let go: by Esc (the window still has focus) or by going to another app (it has not).
  // The focus change can come a moment after the lock change, so look again shortly (a real timer:
  // the game's own timers wait for the unpause).
  real.setTimeout(() => {
    if (hasInput() || pause.has("key")) return;
    const away = !document.hasFocus() || real.now() - lostFocusAt < 600;
    if (!away && escDialog) {
      // Esc closed the dialog: the quiet pause, a click or W goes on (the browser gives the mouse back only then)
      if (dialogs.escapable()) passKeys(() => sendKey("Escape"));
      quietPause = true;
      showMenu(false);
      return;
    }
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
// menus (menu/apply.ts): the settings put to work: render scale, view distance, rooms, reflections, shadows,
// lights, particles, the frame cap, the sound's levels, the mouse and the view
wireSettings({ retro, camera: player.camera, inWorld, lanternLights, alive, sound: () => sound, town, resize });
{
  const c = bootRestore();
  const hint = startEl.querySelector(".hint");
  if (c && hint) hint.textContent = `Loaded${c.clock ? `: ${c.clock.hour}:${String(c.clock.minute).padStart(2, "0")}` : ""}${c.place ? `, ${c.place}` : ""}. Click, or press W, to go on.`;
}

/** Run one part of the frame; an error is logged once (by its message) and the rest of the frame goes on. */
const frameErrors = new Set<string>();
function safe(name: string, fn: () => void): void {
  const t0 = prof.on ? performance.now() : 0;
  try {
    fn();
    if (prof.on) prof.add(name, performance.now() - t0);
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
  crowdNow = together.withPeople(crowd.positions()); // M8a: the other players too (the bridges do not open under them)
  folkNow.length = 0;
  for (const q of crowdNow) folkNow.push(q);
  for (const q of handcarts.points()) folkNow.push(q);
}
const vehicleSounds: VehicleSound[] = [];
const timer = new THREE.Timer();
timer.connect(document);
let elapsed = 0;
/**
 * The menu first (2026-09-27, Steve: "switching tabs takes time ... in multiplayer, give the menu priority
 * and skip frames if needed"). A draw of the town can build shaders and send textures, and the page's own
 * paint (the menu) waits behind that on the GPU, up to seconds. So:
 * - paused, the picture stands: drawn again only when it must be (a resize, a setting changed), and only once
 *   the menu has been left alone a moment;
 * - the town running behind a menu (the first page; played together the menu does not pause): the world
 *   moves on every frame, but it is drawn at most 20 times a second, and not just after a click or key.
 */
const MENU_QUIET_MS = 300;
let menuTouchedAt = -1e9;
let menuDrawAt = -1e9;
for (const ev of ["pointerdown", "keydown", "wheel", "input"]) document.addEventListener(ev, () => (menuTouchedAt = real.now()), { capture: true, passive: true });
prefs.onChange(() => (standDirty = true));
/** Whether this frame draws the town: always in play; behind a menu, only when the menu leaves room. */
function menuLetsDraw(): boolean {
  if (startEl.classList.contains("hidden") && !panelsOpen().length) return true;
  const now = real.now();
  if (now - menuTouchedAt < MENU_QUIET_MS || now - menuDrawAt < 50) return false;
  menuDrawAt = now;
  return true;
}
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
    ...parkWork.pathPoints(),
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
  const frameStart = real.now();
  // the mouse moves after this one are the hand's again (see the end of the frame)
  player.stalled = false;
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  // M7 save and pause: paused, nothing moves; the picture stands (drawn again after a resize or a setting: the menu first, above)
  if (pause.paused) {
    if (standDirty && real.now() - menuTouchedAt > MENU_QUIET_MS) {
      standDirty = false;
      retro.render(world.scene, player.camera, elapsed);
    }
    return;
  }
  standDirty = false;
  tick(dt);
  // a frame that hung: the mouse moves piled up meanwhile would turn the view in one jerk (player/firstPerson.ts)
  player.stalled = real.now() - frameStart > 150;
}

/** One frame of the game: every part moves by dt, then the picture is drawn (frame(), and the frame profiler). */
function tick(dt: number): void {
  elapsed += dt;
  safe("refreshFolk", refreshFolk);
  safe("together.worldFrame", () => together.worldFrame(dt)); // M8b: the moving world run here or shown from the world PC
  safe("world.update", () => world.update(elapsed, dt, player.camera));
  safe("ferry.update", () => ferry.update(dt));
  safe("player.update", () => player.update(dt));
  safe("together.frame", () => together.frame(dt)); // M8a: own state out, the others drawn
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
  safe("together.streetApply", () => together.streetApply(dt)); // M8b: the townspeople other PCs walk
  safe("crowd.update", () => crowd.update(dt, player, player.camera));
  safe("town.update", () => town.update(dt, player));
  safe("parkWork.update", () => parkWork.update(dt));
  safe("together.streetSend", () => together.streetSend(dt)); // M8b: the ones this PC walks, to the others
  safe("journeys.update", () => journeys.update(dt, player));
  safe("market.update", () => market.update(dt, player, jobs.day.dayNum, jobs.day.hourF));
  setLitterClock(jobs.day.dayNum, jobs.day.hourF);
  setClockHands(jobs.day.hourF); // the live hands of every clock (world/clockHands.ts)
  safe("trades.update", () => trades.update(elapsed, dt, player.camera, crowd.fogDistance));
  safe("steenLife.update", () => steenLife.update(dt, jobs.day.hourF, player.camera));
  safe("deeds.update", () => deeds.update(dt, jobs.day.hourF));
  safe("rowing.update", () => rowing.update(dt));
  safe("actions.update", () => actions.update(dt));
  safe("steps.update", () => steps.update(dt, routinesRun()));
  safe("hands.update", () => hands.update(dt, routinesRun()));
  safe("meBody.update", () => meBody.update(dt)); // M7 character
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
  safe("mills.update", () => mills.update(dt, player)); // M7 mills (hook)
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
  // the great storm (world/tempest.ts): its wind and rain in the soundscape
  safe("sound.setTempest", () => {
    const gust = alive.wind.gustAt(player.x, player.z);
    const fury = weatherNow === "storm" ? tempest.level : 0;
    // how much house is round him: walls within a few steps (a lane, a doorway) bring the roofs' drumming near
    let walls = 0;
    if (fury > 0) for (let k = 0; k < 8; k++) for (const r of [1.2, 2.6]) if (world.city.flags(player.x + Math.cos((k * Math.PI) / 4) * r, player.z + Math.sin((k * Math.PI) / 4) * r) === 1) walls++;
    sound?.setTempest(fury, gust, Math.min(1, walls / 6));
    // out in it, the gusts shove Jef (player/firstPerson.ts buffet)
    const indoors = interiors.inside || landmarks.indoors || carolus.indoors || gothic.indoors || prison.indoors;
    player.buffet = indoors ? 0 : fury * Math.min(1, gust / 2);
    tempest.gust = gust;
    tempest.wind = alive.wind;
    // the trees lean with the gale (retro/psx.ts uGale): a storm day a little, the great storm hard and harder in the gusts
    const bend = (weatherNow === "storm" ? 0.35 : weatherNow === "rain" ? 0.1 : 0) + fury * (0.9 + 0.45 * Math.min(gust, 3));
    const gv = psxUniforms.uGale.value;
    gv.set(alive.wind.dir.x, alive.wind.dir.y, gv.z + (bend - gv.z) * Math.min(1, 0.05));
    tempest.indoors = indoors;
    // the tavern's room: its box, measured once when he comes in (world/ambient.ts: rain out of its windows only)
    const room = interiors.room;
    if (room !== stormRoom) {
      stormRoom = room;
      tempest.roomBox = room ? (() => {
        const b = new THREE.Box3().setFromObject(room.group);
        return b.isEmpty() ? null : { min: { x: b.min.x - 0.3, z: b.min.z - 0.3 }, max: { x: b.max.x + 0.3, z: b.max.z + 0.3 } };
      })() : null;
    }
    // the hardest gusts push him a step along with it (he can walk against it, slowly); between them he stands
    const push = indoors ? 0 : fury * Math.min(0.6, Math.max(0, gust - 1.8) * 0.25);
    player.windPush.set(alive.wind.dir.x * push, alive.wind.dir.y * push);
  });
  safe("sound.update", () => sound?.update(player.camera));
  safe("vehicles and people wiring", () => {
  {
    // ships under way whistle and churn; they signal at the lock and the bridges
    const b = world.boats();
    if (b && sound) {
      sound.setMovingShips(b.moving());
      if (!b.onSignal) b.onSignal = (ship, at) => safe("sound.shipSignal", () => sound?.shipSignal(ship, at));
    }
    const tr = world.traffic();
    // the goods train's horses and the omnibus: hooves and wheels (M3g); rail joints and crane work
    const rail = world.railway();
    const bus = world.omnibus();
    if (rail && sound && !rail.onClack) {
      // (a sound never breaks the railway's own update: 2026-09-26, "non-finite AudioParam" at night)
      rail.onClack = (x, z) => safe("sound.railClack", () => sound?.railClack(x, z));
      rail.onCrane = (x, z) => safe("sound.craneWork", () => sound?.craneWork({ kind: "crane", x, z, y: 6 }));
      world.railGate().onBell = (x, z) => safe("sound.gateBell", () => sound?.gateBell(x, z));
      rail.onCraneTravel = (x, z) => safe("sound.gateBell", () => sound?.gateBell(x, z)); // the crane driver's warning bell
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
    // D1 docks: the cranes keep the dockers' piles they reach filled from the ships (the server makes the loads)
    if (rail && !rail.feed) rail.feed = { need: (r) => jobs.goods.pileNeed(r), put: (r, n) => jobs.goods.cranePut(r, n) };
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
    // (sync pass 2: people wait at the stops near every player; the other PCs show the world PC's)
    if (bus && !bus.others) bus.others = () => together.positions();
    // M7 omnibus routes: the timetable runs by the game clock (shared/omnibusLines.ts)
    if (bus && !bus.clock) bus.clock = () => ({ day: jobs.day.dayNum, hour: jobs.day.hourF });
  }
  });
  safe("lanternLights.update", () => {
    lanternLights.update(dt, player.camera, lanternDark());
  });
  safe("spill.update", () => spill.update(dt, player.camera));
  // M7: every room stands in the world now (world/inworld.ts draws it through its openings)
  // (the first screen, while the shaders are built in the background: the picture holds, so the page
  // does not stand still waiting for them; in the game it always draws)
  // (boot: not while the loading screen builds and warms everything; boot/loader.ts draws then)
  // (behind a menu: the menu first, menuLetsDraw above)
  if ((started || (!warmer.pending && !booting())) && menuLetsDraw()) pt("render", () => retro.render(world.scene, player.camera, elapsed));
}
requestAnimationFrame(frame);

// Warm-up (2026-09-26, the stutter; world/warmup.ts, docs/rendering.md): every shader is built in the
// background before it is drawn, in the street and in every room; now, when the city is in, and twice
// a second for what comes later (the town, the market, the houses' rooms). Then, once the city's
// shaders are ready, one draw of everything sends every house chunk and texture to the GPU.
const warmer = new ShaderWarmer(renderer, world.scene, player.camera, () => retro.target, inWorld);
// (issue #7: what a run finds after the loading waits out of the passes until its shaders are ready; the loading
// screen waits for them itself)
retro.hold = warmer;
cull.holds = warmer.holds;
cull.holdMask = L_HOLD;
const warm = () => {
  warmer.holding = !booting();
  return warmer.warm().catch((e) => {
    if (!frameErrors.has(`warm-up: ${e}`)) console.warn("[warm-up]", e);
    frameErrors.add(`warm-up: ${e}`);
  });
};
void warm();
setInterval(() => void warm(), 500);
world.city.ready.then(async () => {
  await warm();
  // (boot: the loading screen draws everything once at its end, the town and the rooms complete; boot/loader.ts)
  if (booting()) return;
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
  // M7: the warm-up draws everything, so the culler stands aside for it
  const culling = cull.enabled;
  cull.enabled = false;
  retro.render(world.scene, player.camera, elapsed);
  cull.enabled = culling;
  for (const [o, f] of culled) o.frustumCulled = f;
  for (const o of hidden) o.visible = false;
}).catch(() => {});

// ---- boot (the loading screen, boot/probe.ts): the start's numbers and the probe's way into the game ----
world.city.ready.then(() => (bootMark("city"), bootNote("city ready"))).catch(() => {});
{
  let turnTimer = 0;
  let lastPos = { x: 0, z: 0, t: 0 };
  bootProbe.attach({
    renderer,
    enter: () => {
      player.freeInput = true;
      startEl.classList.add("hidden");
      started = true;
      if (!sound) start();
      syncPause();
    },
    drive: (on, turn) => {
      player.setKey("KeyW", on);
      clearInterval(turnTimer);
      if (!on) return;
      let k = 0;
      turnTimer = window.setInterval(() => {
        k++;
        player.yaw += turn * 0.05 * Math.sin(k / 40);
        // walked into something: turn away
        if (k % 20 === 0) {
          if (Math.hypot(player.x - lastPos.x, player.z - lastPos.z) < 0.5) player.yaw += Math.PI * 0.6;
          lastPos = { x: player.x, z: player.z, t: k };
        }
      }, 50);
    },
  });
}
// the loading screen's work (boot/loader.ts), then the fade into the menu
void runBoot({
  renderer,
  scene: world.scene,
  camera: player.camera,
  target: () => retro.target,
  inWorld,
  warm: () => warm(),
  draw: () => retro.render(world.scene, player.camera, elapsed),
  culling: (on) => (on === undefined ? cull.enabled : (cull.enabled = on)),
  cityReady: world.city.ready,
  townReady: () => !!town.data,
})
  .catch((e) => console.warn("[boot]", e))
  .finally(() => void finishBoot(startEl));
// ---- end boot ----

// Dev fly mode (F9): fly anywhere, no fog, noon light; a readout of where you are.
// The web demo has it too (Steve 2026-09-27), in the time and weather you are in, with a key hint on screen.
if (import.meta.env.DEV || DEMO) {
  const hud = document.createElement("div");
  hud.className = "devfly";
  hud.style.display = "none";
  document.body.appendChild(hud);
  let back: { x: number; z: number } | null = null;
  // the demo: F9 always in sight, so nobody misses the flying
  const flyHint = DEMO ? document.createElement("div") : null;
  if (flyHint) {
    flyHint.className = "demo-fly-hint";
    flyHint.innerHTML = `<div class="demo-limited">Limited web demo, just a look</div><div><span class="demo-key">F9</span> <span data-fly>fly over the town</span></div><div><span class="demo-key">F8</span> time, weather, events</div><div class="demo-limited" data-keys hidden>WASD fly, mouse look<br>Space up, C down, Shift fast</div>`;
    document.body.appendChild(flyHint);
  }
  const toggleFly = () => {
    player.fly = !player.fly;
    if (!DEMO) world.setDevView(player.fly);
    hud.style.display = player.fly && !DEMO ? "block" : "none"; // the demo shows the keys in its own hint
    const keysLine = flyHint?.querySelector<HTMLElement>("[data-keys]");
    if (keysLine) keysLine.hidden = !player.fly;
    const flyWord = flyHint?.querySelector("[data-fly]");
    if (flyWord) flyWord.textContent = player.fly ? "walk again" : "fly over the town";
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
    hud.textContent = DEMO
      ? "FLYING   WASD fly, mouse look, Space up, C down, Shift fast, F9 land"
      : `DEV FLY  x ${p.x.toFixed(0)}  y ${p.y.toFixed(0)}  z ${p.z.toFixed(0)}   WASD fly, mouse look, Space up, C down, Shift fast, F9 land`;
  }, 200);
}

// M8a multiplayer (net/mp/together.ts, docs/milestones/M8a.md): the other players, the Together panel, no pause together
const together = new Together({
  scene: world.scene,
  camera: player.camera,
  player,
  groundAt: (x, z, r, feet) => world.groundAt(x, z, r, feet),
  isFree: (x, z, r, feet) => world.isFree(x, z, r, feet),
  surfaceAt: (x, z) => world.surfaceAt(x, z),
  buses: () => world.omnibus()?.buses ?? [],
  riding: () => (ride as unknown as { bus: { index: number; pose(): { x: number; y: number; z: number; yaw: number } } | null }).bus,
  away: () => !hasInput() || !startEl.classList.contains("hidden"),
  entered: () => started,
  say: (t) => jobs.say(t),
  sound: () => sound,
  paper: startEl.querySelector(".paper"),
  cityReady: world.city.ready,
  town,
  crowd,
  // M8d: walls on the walk map (another player's view of a job figure is cut by them)
  wallAt: (x, z) => {
    const f = world.city.flags(x, z);
    return f === undefined ? undefined : (f & 1) !== 0;
  },
  // M8b: the boat he rows, the velocipede he rides, the handcart he pushes go with him on the others' screens
  gear: () => {
    const boat = rowing.rowedKind;
    if (player.rowing && boat) return { kind: GEAR.rowboat, sub: Math.max(0, SMALL_KINDS.indexOf(boat)), heading: player.rowHeading };
    if (player.bikeRiding) return { kind: GEAR.velo, sub: 0, heading: player.bikeHeading };
    const cart = handcarts.heldYaw();
    // (M8f goods pass 2: `sub` names the cart he pushes, so the others lay its load on it)
    return cart !== null ? { kind: GEAR.handcart, sub: handcarts.heldSub(), heading: cart } : null;
  },
  gearModel: (kind, sub) => gearModel(world, kind, sub),
  // M8b: the moving world, run by one PC for all (net/mp/world.ts)
  movers: () => ({
    omnibus: world.omnibus(),
    traffic: world.traffic(),
    railway: world.railway(),
    railGate: world.railGate(),
    bridges: world.bridges(),
    lock: world.lock(),
    river: world.river(),
    goodsCarts: jobs.goods.drays, // M8f goods pass 2: the dray and the handcart that move a pile (world/goodsDrays.ts)
  }),
  // the host's town map: the movers as points (twice a second, with the world)
  mapPoints: () => {
    const r = (v: number) => Math.round(v * 10) / 10;
    const drays: VehicleSound[] = [];
    world.traffic()?.sounds(drays);
    return {
      buses: (world.omnibus()?.buses ?? []).map((b) => {
        const p = b.pose();
        return { id: b.index, name: `omnibus ${b.index + 1}`, x: r(p.x), z: r(p.z), yaw: r(p.yaw) };
      }),
      ships: (world.boats()?.moving() ?? []).map((s) => ({ id: s.id, name: s.kind, x: r(s.x), z: r(s.z), yaw: r(s.heading) })),
      drays: drays.map((v, i) => ({ id: i, name: v.kind, x: r(v.x), z: r(v.z), state: v.state })),
      trains: (world.railway()?.vehicles() ?? []).map((v, i) => ({ id: i, name: "goods train", x: r(v.x), z: r(v.z), state: v.state })),
    };
  },
});
together.start();
// M8f shared goods (game/goods.ts): what another player carries goes on his figure, what a townsperson carries on
// his shoulder (whichever PC walks him)
jobs.goods.figureOf = (id) => together.figureOf(id);
// M8f goods pass 2: another player's handcart load on the cart he pushes (the one his gear names)
jobs.goods.remoteCart = (cart) => {
  const m = /^hc:(\d+):/.exec(cart);
  const pivot = m && Number(m[1]) !== jobs.goods.me ? together.gearCart(Number(m[1]), cartSub(cart)) : null;
  return pivot ? handcartFrame(pivot) : null;
};
jobs.goods.npcHands = (npc) => {
  const p = town.puppet(npc);
  if (!p || !crowd.alive(p)) return null;
  return {
    group: p.group,
    scale: p.human.scale || 1,
    cart: p.veh?.spec.kind === "cart",
    load: (on) => {
      crowd.puppetLoad(p, on);
      if (p.sack) p.sack.visible = !on;
    },
  };
};
// M8d: a follow or a seek goes to the player it is about; only the PC that owns the townsperson walks him
if (together.session) actions.mp = { me: () => together.meId(), playerAt: (id) => together.playerAt(id), mayWalk: (id) => town.net?.mayWalk(id) ?? true };
steps.me = () => together.meId(); // M8d: an errand's steps are walked by its player's PC (0 alone: all)
// M8b: the rented home's door opens for its key holder on every screen (until M8c only the host rents)
homes.ownKey = !isGuest();
homes.keyNear = () => together.hostAt();
world.railGate().others = () => together.positions(); // M8b: the gate's leaves wait for every player in their sweep
world.setPlayers(() => together.positions()); // M8b: the lock's beams too

// Dev hook for automated checks: teleport, hold keys, read state.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__scheldemist = {
    player,
    renderer, // (dev: the frame profiler and the uniform count)
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
    /** M8a multiplayer: the other players (report(): own camera snaps, each remote's jitter and buffer; resetMeter()). */
    mp: together,
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
    /** M7 walk-up (dev/popcheck.ts): every job or quest figure that became visible within 20 m of Jef without walking in (`pops` must be empty); `true` resets. */
    popcheck: (reset = false) => popWatch.report(reset),
    /**
     * The trade plan, part A (game/town.ts findCheck): townspeople out in the street within `near` m of Jef (40)
     * who have not been drawn for over 3 s. Must list nothing (the M8b ones another PC walks are left out).
     */
    findcheck: (near = 40) => town.findCheck(near),
    /**
     * T1 (2026-09-28): every run of the town's trade out now by the engine's sums (server town/runs.ts, as the town map
     * has it), and where the game has it: the mill's man (the town), the quay's carts (world/goodsDrays.ts). `d` is the
     * metres between them: under 3 for a cart the game draws, and near 0 unseen.
     */
    runs: () => {
      const { day, hour } = town.clock();
      const carts = jobs.goods.drays?.info() ?? [];
      return runsNow(day, hour, { men: { mill_mid: "ml02", mill_ne: "ml04" } }).map((r) => {
        let game: { x: number; z: number; drawn: boolean } | null = null;
        if (r.man) {
          const p = town.position(r.man);
          game = p ? { x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, drawn: p.shown } : null;
        } else {
          const c = carts.find((q) => `cart:${q.id}` === r.id);
          game = c ? { x: c.x, z: c.z, drawn: true } : null;
        }
        return { id: r.id, doing: r.doing, x: Math.round(r.x * 10) / 10, z: Math.round(r.z * 10) / 10, game, d: game ? Math.round(Math.hypot(game.x - r.x, game.z - r.z) * 10) / 10 : null };
      });
    },
    /** T2: who is held now and for how long (game minutes), and whom the held deadline let go (an hour unseen, untouched). */
    heldcheck: () => town.heldCheck(),
    /** T1: the townspeople late by their progress reports (game minutes), and whether drawn. */
    lagcheck: () => town.lagCheck(),
    /** The carrying check (dev/carrycheck.ts): every docker from a real pile to a door, a pile or a fish bank. Must list no problems. */
    carrycheck: async () => (await import("./dev/carrycheck")).carryCheck({ town, quayPiles: () => quayGoodsInfo()?.placed ?? [], flags: (x: number, z: number) => world.city.flags(x, z) }),
    /** The overlap check (2026-09-27): townspeople within `near` m of Jef standing in one another (middles nearer than `min` m). Must list nothing. */
    overlaps: (near = 40, min = 0.45) =>
      crowd.overlaps(player.x, player.z, near, min).map((o) => ({
        a: town.puppetName(o.a) ?? o.a.kind,
        b: town.puppetName(o.b) ?? o.b.kind,
        d: o.d,
        at: [Math.round(o.a.x * 10) / 10, Math.round(o.a.z * 10) / 10],
        what: o.what,
      })),
    /** The stuck check (dev/stuckcheck.ts): runs the game `seconds` and lists whoever plays a walk but stays on the spot or goes to and fro (must list nothing). */
    stuck: (opts: { seconds?: number; near?: number } = {}) =>
      stuckCheck({ crowd, town, world, player, narrow: rampartStairAt, step: (s) => (window as unknown as { __scheldemist: { step(s: number): void } }).__scheldemist.step(s) }, opts),
    /** M7 walk-up (game/walkup.ts): what was asked, who came, and the server's "come" rows. */
    walkup: {
      log: () => walkup.log.slice(-30),
      /** Someone of a role comes up to Jef now, as a job would call them: come("police", "crime") runs. */
      come: (role: string, why = "trouble") => walkup.devCome(role, why),
      comers: () => walkup.devInfo(),
      coming: async () => (await fetch("/api/walkup")).json(),
    },
    /** Stalls (hook, dev/stallcheck.ts): every stall, shop table, awning and goods pile against the house walls, doors and the walk map (should list nothing). */
    stallcheck: async (only?: string) => {
      const m = await import("./dev/stallcheck");
      return m.checkStalls(world, m.allDoors(town.data), { only });
    },
    /** Props (dev/propcheck.ts): every solid prop of the town (barrels, crates, pumps, heaps ...) against the buildings as built, doors, passages, bills, each other and the ground (should list nothing). */
    propcheck: async (opts: { only?: string; list?: number; near?: [number, number, number] } = {}) => {
      const m = await import("./dev/propcheck");
      return m.checkProps(world, town.data, opts);
    },
    /** M7 posters: every bill on the walls and every place for the engine's bills, against the houses as built (dev/postercheck.ts; should list nothing). */
    posters: async () => {
      const sl = world.streetLife();
      const p = world.posters();
      return sl && p ? (await import("./dev/postercheck")).checkPosters(world.city.group, world.city.flags, sl, p, undefined, world.scene) : "the bills are not up yet";
    },
    /** Every clock face (world/clockHands.ts): where, what, the time it shows against the game's; `problems` must be empty. */
    clocks: () => clockReport(world.scene, jobs.day.hourF),
    /** Z-fight check (dev/zfight.ts): faces of the static world in one plane that overlap, and layers too close to their surface, by cause (M3c pass 5). */
    zfight: async (opts = {}) => (await import("./dev/zfight")).checkZFight(world.scene, world.city.flags, opts),
    /** Bump audit (dev/bumpaudit.ts): every material of the street and of every room, its picture and its relief; `flat` lists the flat ones. `text: true` gives the list as text. */
    bumpaudit: async (opts: { list?: number; text?: boolean } = {}) => {
      const m = await import("./dev/bumpaudit");
      const a = m.bumpAudit([{ scene: world.scene }, ...inWorld.all.map((r) => ({ scene: r.scene, prefix: `room ${r.id}: ` }))], opts);
      return opts.text ? m.bumpAuditText(a) : a;
    },
    /** Night fog (dev/fogcheck.ts): far fogged things lighter than the sky just above them (`problems` must be empty). */
    fogcheck: async (opts = {}) => (await import("./dev/fogcheck")).fogCheck({ renderer, retro, scene: world.scene, camera: player.camera, canvas, update: (cam) => world.update(elapsed, 0.016, cam), lights: (cam) => spill.lights(cam) }, opts),
    /** M7 prison real: every building with an inside against its shell (dev/interiorcheck.ts, docs/building-with-interior.md): must list nothing wrong. */
    interiorcheck: async (only?: string) => {
      const m = await import("./dev/interiorcheck");
      const halls = [...landmarks.inWorldHalls, carolus.hall, ...gothic.halls, ...prison.halls()];
      const houses = [...interiors.inWorldHouses, ...homes.inWorldHouses] as unknown as Parameters<typeof m.targetsFrom>[2];
      return m.checkInteriors(world.scene, inWorld, m.targetsFrom(inWorld, halls, houses, ["prison_governor"]), only);
    },
    /**
     * Issue #29: the city houses' punch in the view now (dev/punchcheck.ts): the pixels it clears, and those where the
     * linings or the paving still change what a house's room shows (`covered` must be 0). `{ old: true }`: the punch as it was.
     */
    punchcheck: async (opts: { old?: boolean; from?: [number, number, number]; to?: [number, number, number]; shot?: string } = {}) => {
      const m = await import("./dev/punchcheck");
      const cam = player.camera;
      const keep = { p: cam.position.clone(), q: cam.quaternion.clone() };
      if (opts.from && opts.to) {
        // (as shotFrom: the eye there, the world, the people and the spilt light seen from it)
        cam.position.set(...opts.from);
        cam.lookAt(...opts.to);
        cam.updateMatrixWorld();
        world.update(elapsed, 0.016, cam);
        crowd.update(0.0001, player, cam);
        spill.update(0.0001, cam, true);
      }
      const pics: Array<{ name: string; url: string }> = [];
      const grab = opts.shot ? (what: string) => pics.push({ name: `${opts.shot}_${opts.old ? "old" : "new"}_${what}`, url: canvas.toDataURL("image/jpeg", 0.85) }) : undefined;
      try {
        const r = m.punchCheck({ renderer, target: retro.target, draw: () => retro.render(world.scene, cam, elapsed), scene: world.scene, inWorld, grab }, opts);
        for (const p of pics) await fetch("/api/dev/shot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
        return { ...r, shots: pics.map((p) => `data/shots/${p.name}.jpg`) };
      } finally {
        cam.position.copy(keep.p);
        cam.quaternion.copy(keep.q);
        cam.updateMatrixWorld();
      }
    },
    /** The landmarks' windows lit at night (world/landmarkWindows.ts): per building, its windows and their light on the street. */
    litWindows: () => landmarks.windows?.info() ?? [],
    /** M7 halls: the checks of the halls in the world (dev/hallcheck.ts): pictures, the walk through a door (pops), holes in a hall. */
    halls: async () => {
      const d = (window as unknown as { __scheldemist: { step(s: number): void; shot(n: string): Promise<string> } }).__scheldemist;
      return (await import("./dev/hallcheck")).makeHallCheck({ halls: () => [...landmarks.inWorldHalls, carolus.hall, ...gothic.halls, ...prison.halls()], player, world, inWorld, renderer, render: (cam, t) => retro.render(world.scene, cam, t), update: (dt) => d.step(dt), shot: (n) => d.shot(n) });
    },
    /** Empty fronts (world/emptyFronts.ts): every house cut open in the city and what stands behind its door and windows; `problems` must be empty. */
    emptyfronts: async () => (await import("./world/emptyFronts")).emptyFrontsReport(),
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
      for (const q of parkWork.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
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
      // M7 mills: the mills' doors on the wall, where the cap is turned, the carts' stand and stops
      for (const q of mills.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
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
      // the spilt light as seen from the picture's place (world/spill.ts)
      spill.update(0.0001, cam, true);
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
      cam.updateMatrixWorld();
      spill.update(0.0001, cam, true);
      const r = await fetch("/api/dev/shot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, url }) });
      return r.ok ? `data/shots/${name}.jpg` : `failed ${r.status}`;
    },
    /**
     * Shaders (2026-09-26, the stutter; docs/rendering.md): how many, in which light settings, and
     * `problems`, which must be empty: the street is one light setting and all rooms are one more;
     * no scene material drawn straight to the screen (a second, sRGB set of shaders).
     */
    shaders() {
      const sets: Record<string, number> = {};
      const screen: string[] = [];
      const MESH = ["basic", "lambert", "phong", "standard", "physical", "toon", "matcap", "sprite", "points"];
      for (const p of renderer.info.programs ?? []) {
        const k = p.cacheKey.split(",");
        const i = k.findIndex((v) => v === "highp" || v === "mediump" || v === "lowp");
        if (i < 0) continue;
        if (k[i + 1] !== "srgb-linear" && MESH.includes(k[0])) screen.push(p.name || k[0]);
        if (!["lambert", "phong", "standard", "physical", "toon"].includes(k[0])) continue;
        // three.js's program key (WebGLPrograms.getProgramCacheKeyParameters), counted from the precision
        const set = `dir ${k[i + 33]}, point ${k[i + 34]}, hemi ${k[i + 37]}, point shadows ${k[i + 41]}`;
        sets[set] = (sets[set] ?? 0) + 1;
      }
      const problems: string[] = [];
      if (Object.keys(sets).length > 2) problems.push(`${Object.keys(sets).length} light settings (the street and the rooms should be 2): a room over ROOM_POINT_LIGHTS, or street lights that come and go`);
      if (screen.length) problems.push(`${screen.length} scene shaders drawn to the screen, not into the retro target: ${screen.slice(0, 8).join(", ")}`);
      return { programs: renderer.info.programs?.length ?? 0, lightSettings: sets, warmer: { ...warmer.stats, pending: warmer.pending, onHold: warmer.holds.size }, problems };
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
        safe("perf: world.update", () => world.update(elapsed, 1 / 60, player.camera)); // (a part that throws never stops the timing)
        safe("perf: lanternLights.redraw", () => lanternLights.redraw());
        retro.render(world.scene, player.camera, elapsed);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        calls = renderer.info.render.calls;
        tris = renderer.info.render.triangles;
      }
      const ms = (performance.now() - t0) / n;
      renderer.info.autoReset = true;
      return { msPerFrame: +ms.toFixed(2), calls, tris };
    },
    /**
     * The frame profiler (2026-09-28, the slow frames): n whole game frames (every part and the draw, the
     * GPU finished after each), timed part by part. `live: s` instead times the real frames for s seconds
     * (the tab must be in view): the gaps between frames, the long tasks, and the parts.
     */
    async frameProf(opts: { n?: number; live?: number; top?: number; turn?: number } = {}) {
      const gl = renderer.getContext();
      const px = new Uint8Array(4);
      const mem = () => ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576;
      const heap0 = mem();
      prof.reset();
      routeStats.made = routeStats.hits = routeStats.unknown = 0;
      const frames: number[] = [];
      const gpu: number[] = [];
      let calls = 0;
      let tris = 0;
      let long: number[] = [];
      if (opts.live) {
        const obs = typeof PerformanceObserver !== "undefined" ? new PerformanceObserver((l) => l.getEntries().forEach((e) => long.push(Math.round(e.duration)))) : null;
        try {
          obs?.observe({ type: "longtask", buffered: false });
        } catch {
          /* no long tasks in this browser */
        }
        let last = real.now();
        let going = true;
        const gap = () => {
          if (!going) return;
          const t = real.now();
          frames.push(t - last);
          last = t;
          requestAnimationFrame(gap);
        };
        prof.on = true;
        requestAnimationFrame(gap);
        await new Promise((r) => real.setTimeout(r, opts.live! * 1000));
        going = false;
        prof.on = false;
        obs?.disconnect();
        calls = renderer.info.render.calls;
        tris = renderer.info.render.triangles;
      } else {
        const n = opts.n ?? 120;
        renderer.info.autoReset = false;
        prof.on = true;
        for (let i = 0; i < n; i++) {
          // (the jobs a frame leaves for after its task: the mirrors' once-a-frame flags clear there)
          await Promise.resolve();
          renderer.info.reset();
          // (turn: degrees a frame, a look round as with the mouse)
          if (opts.turn) player.yaw += THREE.MathUtils.degToRad(opts.turn);
          const t0 = performance.now();
          tick(1 / 60);
          const g0 = performance.now();
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const t1 = performance.now();
          gpu.push(t1 - g0);
          frames.push(t1 - t0);
          calls = renderer.info.render.calls;
          tris = renderer.info.render.triangles;
        }
        prof.on = false;
        renderer.info.autoReset = true;
        long = [];
      }
      const size = new THREE.Vector2();
      renderer.getDrawingBufferSize(size);
      return {
        mode: opts.live ? `live ${opts.live} s` : `${frames.length} frames`,
        frame: quantiles(frames),
        over33: frames.filter((f) => f > 33.4).length,
        over50: frames.filter((f) => f > 50).length,
        gpuWait: gpu.length ? quantiles(gpu) : null,
        longTasks: long.length ? { n: long.length, max: Math.max(...long), sum: long.reduce((a, b) => a + b, 0) } : null,
        calls,
        tris,
        canvas: `${size.x}x${size.y}`,
        target: `${retro.target.width}x${retro.target.height}`,
        programs: renderer.info.programs?.length ?? 0,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        sceneObjects: (() => {
          let n = 0;
          world.scene.traverse(() => void n++);
          return n;
        })(),
        routes: { ...routeStats },
        heapMB: +mem().toFixed(0),
        heapGrowMB: +(mem() - heap0).toFixed(1),
        parts: profTable(frames.length, opts.top ?? 40),
      };
    },
    /** Dev (2026-09-28): the draw calls of a few whole frames by where they come from (dev/frameProf.ts). */
    drawAudit: (o?: { frames?: number; depth?: number; top?: number }) => drawAudit(renderer, () => tick(1 / 60), o),
    /**
     * Dev (2026-09-28): the same moment drawn two ways, the pictures compared (dev/frameProf.ts pixelDiff). `what`:
     * "uniforms" (the array uniform cache on, then off), "same" (twice the same: the noise floor).
     */
    pixelDiff(what: "uniforms" | "matrices" | "water" | "merge" | "share" | "cull" | "control" | "globals" | "same" = "same", frames = 3) {
      const draw = () => retro.render(world.scene, player.camera, elapsed);
      // ("water": a mirror whose surfaces the culler hides is left out; off, it draws as before)
      const keepHid = mirrorView.hiddenInMain;
      const water = {
        get on() {
          return mirrorView.hiddenInMain !== null;
        },
        set on(v: boolean) {
          mirrorView.hiddenInMain = v ? keepHid : null;
        },
      };
      // ("globals": the shared psx uniforms once per program and render call, against every material switch)
      const globalsSw = {
        get on() {
          return uniformCache.globals;
        },
        set on(v: boolean) {
          uniformCache.globals = v;
        },
      };
      // ("control": the view turned half a degree: must differ, else the test sees nothing)
      const fov0 = player.camera.fov;
      const control = {
        get on() {
          return player.camera.fov === fov0;
        },
        set on(v: boolean) {
          player.camera.fov = v ? fov0 : fov0 + 0.5;
          player.camera.updateProjectionMatrix();
        },
      };
      // ("cull": the culler against no culling at all: what it hides must not show)
      const culling = {
        get on() {
          return cull.enabled;
        },
        set on(v: boolean) {
          cull.enabled = v;
        },
      };
      const sw =
        what === "uniforms" ? uniformCache : what === "matrices" ? matrixSkip : what === "water" ? water : what === "merge" ? staticMerge : what === "share" ? materialShare : what === "cull" ? culling : what === "control" ? control : what === "globals" ? globalsSw : null;
      // (a switch that swaps things in the scene: the culler judges the new ones at once)
      // (the culler's own test keeps its evaluation: a staged one on its way is what is tested)
      const on = () => sw && ((sw.on = true), sw !== culling && cull.invalidate());
      const off = () => sw && ((sw.on = false), sw !== culling && cull.invalidate());
      try {
        return pixelDiff(renderer, retro.target, draw, on, sw ? off : on, frames);
      } finally {
        if (sw) sw.on = true;
      }
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
        safe("step: together.worldFrame", () => together.worldFrame(dt)); // M8b
        // (with the camera, as a frame does: the railway, its cranes and the train only run with one; D1 docks tests)
        safe("step: world.update", () => world.update(elapsed, dt, player.camera));
        safe("step: ferry.update", () => ferry.update(dt));
        safe("step: player.update", () => player.update(dt));
        safe("step: together.frame", () => together.frame(dt)); // M8a
        safe("step: handcarts.update", () => handcarts.update(dt));
        safe("step: interiors.update", () => interiors.update(dt));
        safe("step: homes.update", () => homes.update(dt));
        safe("step: landmarks.update", () => landmarks.update(dt));
        safe("step: carolus, gothic, prison", () => {
          const d = landmarks.daylight();
          carolus.update(elapsed, dt, jobs.day.hourF, d.day, d.sky);
          gothic.update(elapsed, dt, jobs.day.hourF, d.day, d.sky);
          prison.update(elapsed, dt, jobs.day.dayNum, jobs.day.hourF, d.day, d.sky); // M7 prison and squares
        });
        safe("step: jobs.update", () => jobs.update(dt));
        safe("step: boxes.update", () => boxes.update(elapsed));
        safe("step: night.update", () => night.update(dt));
        safe("step: crowd.setHour", () => crowd.setHour(jobs.day.hour)); // (as the frame does: the crowd's hour, its lanterns after dark)
        safe("step: together.streetApply", () => together.streetApply(dt)); // M8b
        safe("step: crowd.update", () => crowd.update(dt, player, player.camera));
        safe("step: town.update", () => town.update(dt, player));
        safe("step: parkWork.update", () => parkWork.update(dt));
        safe("step: together.streetSend", () => together.streetSend(dt)); // M8b
        safe("step: journeys.update", () => journeys.update(dt, player));
        safe("step: market.update", () => market.update(dt, player, jobs.day.dayNum, jobs.day.hourF));
        safe("step: setLitterClock", () => setLitterClock(jobs.day.dayNum, jobs.day.hourF));
        safe("step: setClockHands", () => setClockHands(jobs.day.hourF)); // the live hands of every clock (world/clockHands.ts)
        safe("step: trades.update", () => trades.update(elapsed, dt, player.camera, crowd.fogDistance));
        safe("step: steenLife.update", () => steenLife.update(dt, jobs.day.hourF, player.camera));
        safe("step: deeds.update", () => deeds.update(dt, jobs.day.hourF));
        safe("step: rowing.update", () => rowing.update(dt));
        safe("step: actions.update", () => actions.update(dt));
        safe("step: steps.update", () => steps.update(dt, routinesRun()));
        safe("step: hands.update", () => hands.update(dt, routinesRun()));
        safe("step: meBody.update", () => meBody.update(dt)); // M7 character
        safe("step: families.update", () => families.update(dt));
        safe("step: events.update", () => events.update(dt, player));
        safe("step: hearses.update", () => hearses.update(dt, player, events.list));
        safe("step: townLife.update", () => townLife.update(dt, player, jobs.day.hourF));
        safe("step: bubbles.update", () => bubbles.update(dt, player.camera));
        safe("step: ballads.update", () => ballads.update(dt, player.camera));
        safe("step: press.update", () => press.update(dt));
        safe("step: ideas.update", () => ideas.update(dt));
        safe("step: emigrants.update", () => emigrants.update(dt));
        safe("step: lively.update", () => lively.update(dt, player, player.camera, crowd.fogDistance));
        safe("step: backLife.update", () => backLife.update(dt, player)); // M7 back of town (hook)
        safe("step: mills.update", () => mills.update(dt, player)); // M7 mills (hook)
        safe("step: animals.update", () => animals.update(dt, player, player.camera, crowd.fogDistance, jobs.day.hour >= 19 || jobs.day.hour < 7));
        safe("step: alive.update", () => alive.update(elapsed, dt, player.camera, { day: jobs.day.dayNum, hour: jobs.day.hourF }, weatherNow)); // M7 alive (hook)
        safe("step: lanternLights.update", () => lanternLights.update(dt, player.camera, lanternDark()));
        safe("step: spill.update", () => spill.update(dt, player.camera));
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
  // light spilt from windows, doors, lamps and lanterns (world/spill.ts): __scheldemist.spill() lists every lit source
  // in view range, whether it spills and glows, and `problems` (must be empty); .spillInfo() the counts
  Object.assign((window as unknown as { __scheldemist: object }).__scheldemist, {
    spill: (all = false) => spill.check(player.camera, all),
    spillInfo: () => spill.info(),
    spillBudget: (n?: number, bars = true) => {
      if (n !== undefined) setSpillBudget(n, bars);
      return spillBudget();
    },
  });
  // M7 back of town (hook): __scheldemist.back.info(), .at(place)
  Object.assign((window as unknown as { __scheldemist: object }).__scheldemist, { back: backLife });
  // M7 mills (hook): __scheldemist.mills.info(), the carts, the men, the sails
  Object.assign((window as unknown as { __scheldemist: object }).__scheldemist, { mills });
  // the ink cursor and the dialogs up (game/cursor.ts, game/dialogs.ts): t.focusTest(), t.mouseTest()
  Object.assign((window as unknown as { __scheldemist: object }).__scheldemist, { ink, dialogs });
  mountCullHud(cull);
}

import * as THREE from "three";
import "./style.css";
import { RetroPass } from "./retro/retroPass";
import { psxUniforms } from "./retro/psx";
import { BOARD_POS, DOSS_POS, RAMP, SPOTS, buildRijnkaai } from "./world/rijnkaai";
import { FirstPerson } from "./player/firstPerson";
import { Soundscape } from "./audio/soundscape";
import { Jobs } from "./game/jobs";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const startEl = document.getElementById("start") as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(1);

const world = buildRijnkaai();
const player = new FirstPerson(world, canvas);
const retro = new RetroPass(renderer);
let sound: Soundscape | null = null;
const jobs = new Jobs(world, player);

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  const aspect = w / h;
  player.camera.aspect = aspect;
  player.camera.updateProjectionMatrix();
  retro.resize(aspect);
  // vertex snap grid: half the render resolution, so things wobble visibly
  psxUniforms.uSnapRes.value.set(retro.width * 0.5, retro.height * 0.5);
}
window.addEventListener("resize", resize);
resize();

function start(): void {
  if (!sound) {
    sound = new Soundscape(
      world.lamps.map((l) => l.pos),
      world.shipPositions,
    );
    player.onStep = (surface, hurry) => sound?.footstep(surface, hurry);
    jobs.sfx = (name, at) => sound?.play(name, at);
    player.onLand = (surface) => sound?.footstep(surface, true);
  }
  sound.resume();
  player.lock();
}
startEl.addEventListener("click", start);
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
  world.update(elapsed, dt);
  player.update(dt);
  jobs.update(dt);
  sound?.update(player.camera);
  retro.render(world.scene, player.camera, elapsed);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Dev hook for automated checks: teleport, hold keys, read state.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__scheldemist = {
    player,
    world,
    jobs,
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
      if (!can(DOSS_POS.x, DOSS_POS.z, 2.0)) bad.push("the doss house gate");
      if (!can(RAMP.x - 0.6, RAMP.zHigh - 1.0, 2.4)) bad.push("the mate on deck");
      return bad;
    },
    /** Run the game logic for some seconds at 60 Hz, without waiting for frames. */
    step(seconds: number) {
      const dt = 1 / 60;
      for (let t = 0; t < seconds; t += dt) {
        elapsed += dt;
        world.update(elapsed, dt);
        player.update(dt);
        jobs.update(dt);
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

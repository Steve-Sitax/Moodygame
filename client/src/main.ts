import * as THREE from "three";
import "./style.css";
import { RetroPass } from "./retro/retroPass";
import { psxUniforms } from "./retro/psx";
import { buildRijnkaai } from "./world/rijnkaai";
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

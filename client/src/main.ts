import * as THREE from "three";
import "./style.css";
import { RetroPass } from "./retro/retroPass";
import { psxUniforms } from "./retro/psx";
import { buildRijnkaai } from "./world/rijnkaai";
import { FirstPerson } from "./player/firstPerson";
import { Soundscape } from "./audio/soundscape";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const startEl = document.getElementById("start") as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(1);

const world = buildRijnkaai();
const player = new FirstPerson(world, canvas);
const retro = new RetroPass(renderer);
let sound: Soundscape | null = null;

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

import * as THREE from "three";
import { snort, thunder } from "../../audio/aliveSounds";
import { FCOMMON, VCOMMON, pointMat, rand, type Ctx, type Frame, type Part } from "./common";
import { HORSE_NOSE } from "../horseGait";
import { AIR_GLOW_GLSL, airGlowUniforms } from "../../retro/psx";

// M7 alive: the air and what falls through it.
// (The water off the eaves, drops and broken gutters' streams: eaves.ts.)
// - Thunder and lightning on a storm day (and now and then in a heavy shower): the sky and the air
//   flash, twice or three times, and the thunder follows after the time the sound takes (343 m/s)
//   from a strike 0.8 to 6 km off, a crack when it is near, a long roll when it is far.
// - Breath in the cold: Jef's own, a small cloud in front of his face every few seconds on a cold
//   morning or night (faster when he hurries), and the horses' of the drays, the goods train and the
//   omnibus, blown from their noses; now and then one blows out loud (within 12 m).

// ------------------------------------------------------------------ thunder and lightning

export function createStorm(ctx: Ctx): Part {
  let on = true;
  let wait = 20;
  let flash = -1;
  let pattern: Array<[number, number]> = [];
  let sky: THREE.HemisphereLight | null = null;
  let lastSet = -1;
  let lastBoost = 0;
  let strikes = 0;
  const flashCol = new THREE.Color(0.75, 0.8, 1.0);
  /** Dev: a strike now, `km` off. */
  let forced = -1;

  function level(): number {
    if (flash < 0) return 0;
    let v = 0;
    for (const [t0, a] of pattern) {
      const dtm = flash - t0;
      if (dtm >= 0 && dtm < 0.25) v = Math.max(v, a * Math.exp(-dtm * 14));
    }
    return v;
  }

  function update(f: Frame): void {
    if (!sky) ctx.scene.traverse((o) => {
      if (!sky && (o as THREE.HemisphereLight).isHemisphereLight) sky = o as THREE.HemisphereLight;
    });
    // undo last frame's boost if the world has not set the light again since
    if (sky && lastBoost && sky.intensity === lastSet) sky.intensity -= lastBoost;
    lastBoost = 0;
    if (!on) return;
    const storm = f.weather === "storm";
    const heavy = f.weather === "rain" && f.rain > 0.8;
    wait -= f.dt;
    if (forced >= 0 || ((storm || heavy) && wait <= 0)) {
      wait = storm ? rand(15, 55) : rand(150, 400);
      const km = forced >= 0 ? forced : rand(0.8, 6);
      forced = -1;
      flash = 0;
      // two or three flickers over half a second, weaker far away
      const k = Math.max(0.25, 1 - km / 7);
      pattern = [[0, k], [rand(0.08, 0.14), k * rand(0.3, 0.6)], [rand(0.2, 0.35), k * rand(0.5, 0.9)]];
      strikes++;
      const delay = (km * 1000) / 343;
      const eye = { x: f.eye.x, z: f.eye.z };
      window.setTimeout(() => {
        // the thunder comes from the strike's side, far off: placed in the air 300 m out that way
        const a = Math.random() * Math.PI * 2;
        ctx.sound()?.placed({ x: eye.x + Math.cos(a) * 300, y: 200, z: eye.z + Math.sin(a) * 300 }, { ref: 400, reach: 5000, max: 1e9, occl: 0, wet: 0.8, gain: 1.4 }, thunder(km));
      }, delay * 1000);
    }
    if (flash >= 0) {
      flash += f.dt;
      const v = level();
      if (flash > 0.6) flash = -1;
      // the air and the sky light up (the world sets them again each frame)
      const fog = ctx.scene.fog as THREE.Fog | null;
      if (fog && v > 0) {
        fog.color.lerp(flashCol, v * 0.7);
        if (ctx.scene.background instanceof THREE.Color) ctx.scene.background.copy(fog.color);
      }
      if (sky && v > 0) {
        lastBoost = v * 3;
        sky.intensity += lastBoost;
        lastSet = sky.intensity;
      }
    }
  }
  return {
    name: "storm",
    update,
    info: () => ({ strikes, next: +wait.toFixed(1), flashing: flash >= 0 }),
    setOn: (v) => {
      on = v;
    },
    ...{ strike: (km = 1.5) => (forced = km) },
  } as Part;
}

// ------------------------------------------------------------------ breath in the cold

const PUFFS = 90;

export function createBreath(ctx: Ctx): Part {
  const pos = new Float32Array(PUFFS * 3);
  const age = new Float32Array(PUFFS);
  const size = new Float32Array(PUFFS).fill(1);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aAge", new THREE.BufferAttribute(age, 1));
  g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  const tint = { value: new THREE.Color() };
  const mat = pointMat({
    uniforms: { uTint: tint, ...airGlowUniforms() },
    vertexShader: /* glsl */ `
      ${VCOMMON}
      uniform float fogFar;
      ${AIR_GLOW_GLSL}
      attribute float aAge;
      attribute float aSize;
      varying float vA;
      varying float vS;
      varying vec3 vGlow;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFogDepth = -mv.z;
        gl_Position = psxSnap(projectionMatrix * mv);
        gl_PointSize = clamp(pointPx((0.07 + aAge * 0.24) * aSize, gl_Position), 2.0, 90.0);
        vA = aAge < 0.0 ? 0.0 : smoothstep(0.0, 0.12, aAge) * (1.0 - aAge) * (0.7 + 0.3 * aSize);
        vS = position.x * 3.1 + position.z * 1.7;
        if (aAge < 0.0 || -mv.z < 0.12) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        // a breath is a little mist lit as the fog round it is: the gas lamps' glow of the whole air behind it
        // (else, a hand from the eye, it is the bare fog colour: a dark blue spot on the lit night fog; 2026-09-27)
        else vGlow = airGlow(cameraPosition + normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition) * 1e4, fogFar);
      }`,
    fragmentShader: /* glsl */ `
      ${FCOMMON}
      uniform vec3 uTint;
      varying float vA;
      varying float vS;
      varying vec3 vGlow;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c) * 4.0;
        if (d > 1.0) discard;
        float mottle = 0.6 + 0.4 * hash12(floor(gl_PointCoord * 4.0) + vS);
        float a = vA * (1.0 - d) * (1.0 - d) * mottle * 0.2;
        if (a < 0.004) discard;
        gl_FragColor = vec4(mix(uTint, fogColor, fogK()) + vGlow, a);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.name = "alive_breath";
  pts.renderOrder = 4;
  ctx.scene.add(pts);
  interface Puff { p: THREE.Vector3; v: THREE.Vector3; age: number; life: number; size: number }
  const puffs: Puff[] = Array.from({ length: PUFFS }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), age: -1, life: 1, size: 1 }));
  let on = true;
  let next = 1;
  let lastEye = new THREE.Vector3();
  let speed = 0;
  const fwd = new THREE.Vector3();
  const w2 = new THREE.Vector2();
  // the horses: their instanced bodies (world/traffic.ts "tr_horse_body", world/horses.ts "horse_body")
  let horseMeshes: THREE.InstancedMesh[] = [];
  let scanWait = 0;
  const horseNext = new Map<string, number>();
  const m4 = new THREE.Matrix4();
  const head = new THREE.Vector3();
  const hp = new THREE.Vector3();
  const hq = new THREE.Quaternion();
  const hs = new THREE.Vector3();
  let horsesSeen = 0;
  let lastHorse: number[] | null = null;

  function emit(at: THREE.Vector3, dir: THREE.Vector3, n: number, spread: number, life: number, big = 1): void {
    for (let i = 0; i < PUFFS && n > 0; i++) {
      const q = puffs[i];
      if (q.age >= 0) continue;
      q.p.copy(at);
      q.v.copy(dir).multiplyScalar(0.35 + Math.random() * 0.25).add(new THREE.Vector3((Math.random() - 0.5) * spread, 0.05 + Math.random() * 0.06, (Math.random() - 0.5) * spread));
      q.age = 0;
      q.life = life * (0.8 + Math.random() * 0.4);
      q.size = big;
      n--;
    }
  }

  function update(f: Frame): void {
    if (!on) return;
    const dt = f.dt;
    const moved = f.eye.distanceTo(lastEye);
    speed = dt > 0 && moved < 5 ? speed + (moved / dt - speed) * Math.min(1, dt * 3) : speed;
    lastEye.copy(f.eye);
    const fog = ctx.scene.fog as THREE.Fog | null;
    if (fog) tint.value.copy(fog.color).lerp(new THREE.Color(0.8, 0.82, 0.85), 0.5 * (1 - f.night));
    const cold = f.cold;
    if (cold > 0.3) {
      // Jef: out through the mouth, a little below the eye and ahead
      next -= dt;
      if (next <= 0) {
        next = (speed > 2.5 ? 1.6 : 3.4) * rand(0.85, 1.15);
        f.cam.getWorldDirection(fwd);
        fwd.y = Math.min(fwd.y, 0.1);
        fwd.normalize();
        // (low in the view: it shows at the bottom of the picture, and drifts out of it)
        const at = f.eye.clone().addScaledVector(fwd, 0.42);
        at.y -= 0.26;
        emit(at, fwd, 3, 0.06, 1.1 * cold);
      }
      // the horses: now and then, from the nose
      scanWait -= dt;
      if (scanWait <= 0) {
        scanWait = 3;
        horseMeshes = [];
        ctx.scene.traverse((o) => {
          const m = o as THREE.InstancedMesh;
          if (m.isInstancedMesh && (m.name === "tr_horse_body" || m.name === "horse_body")) horseMeshes.push(m);
        });
      }
      horsesSeen = 0;
      for (const m of horseMeshes) {
        if (!m.visible) continue;
        m.updateMatrixWorld();
        for (let i = 0; i < m.count; i++) {
          m.getMatrixAt(i, m4);
          m4.premultiply(m.matrixWorld);
          m4.decompose(hp, hq, hs);
          if (!(hs.x > 0.01) || !Number.isFinite(hp.x) || hp.lengthSq() < 1e-6) continue; // (hidden, or not placed yet: at the origin)
          if (Math.hypot(hp.x - f.eye.x, hp.z - f.eye.z) > 25) continue;
          horsesSeen++;
          const key = `${m.id}:${i}`;
          const t0 = horseNext.get(key) ?? f.t + Math.random() * 3;
          if (f.t < t0) {
            horseNext.set(key, t0);
            continue;
          }
          horseNext.set(key, f.t + rand(2.6, 4.2));
          // the nose (horseGait.ts HORSE_NOSE, in the body's frame)
          head.set(HORSE_NOSE[0], HORSE_NOSE[1], HORSE_NOSE[2]).applyMatrix4(m4);
          fwd.set(0, -0.3, 1).transformDirection(m4);
          emit(head, fwd, 7, 0.14, 1.8 * cold, 2.2);
          lastHorse = head.toArray().map((v) => +v.toFixed(2));
          if (Math.random() < 0.12 && Math.hypot(head.x - f.eye.x, head.z - f.eye.z) < 12) ctx.sound()?.placed(head, { ref: 1.5, reach: 8, max: 12 }, snort());
        }
      }
    }
    let live = 0;
    for (let i = 0; i < PUFFS; i++) {
      const q = puffs[i];
      if (q.age >= 0) {
        q.age += dt / q.life;
        ctx.wind.at(q.p.x, q.p.z, w2);
        q.v.multiplyScalar(Math.max(0, 1 - dt * 2.2));
        q.p.x += (q.v.x + w2.x * 0.25) * dt;
        q.p.y += (q.v.y + 0.08) * dt;
        q.p.z += (q.v.z + w2.y * 0.25) * dt;
        if (q.age >= 1) q.age = -1;
        else live++;
      }
      pos.set([q.p.x, q.p.y, q.p.z], i * 3);
      age[i] = q.age;
      size[i] = q.size;
    }
    pts.visible = live > 0;
    g.attributes.position.needsUpdate = true;
    g.attributes.aAge.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }
  return {
    name: "breath",
    update,
    info: () => ({ puffs: puffs.filter((q) => q.age >= 0).length, horses: horsesSeen, lastHorse }),
    setOn: (v) => {
      on = v;
      pts.visible = v;
    },
  };
}

import * as THREE from "three";
import { drip, snort, thunder } from "../../audio/aliveSounds";
import { FCOMMON, VCOMMON, pointMat, rand, type Ctx, type Frame, type Part } from "./common";
import { HOUSES, P, roofOf } from "./roofs";

// M7 alive: the air and what falls through it.
// - Water off the eaves: in the rain (and for a while after it, less and less) drops fall from the
//   eaves of the houses along the street round Jef and splash on the stones; each plinks within 4 m.
// - Thunder and lightning on a storm day (and now and then in a heavy shower): the sky and the air
//   flash, twice or three times, and the thunder follows after the time the sound takes (343 m/s)
//   from a strike 0.8 to 6 km off, a crack when it is near, a long roll when it is far.
// - Breath in the cold: Jef's own, a small cloud in front of his face every few seconds on a cold
//   morning or night (faster when he hurries), and the horses' of the drays, the goods train and the
//   omnibus, blown from their noses; now and then one blows out loud (within 12 m).

// ------------------------------------------------------------------ drips off the eaves

const DROPS = 160;

interface Eave {
  a: [number, number];
  b: [number, number];
  y: number;
}

export function createDrips(ctx: Ctx): Part {
  const pos = new Float32Array(DROPS * 2 * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xc4ccd4, transparent: true, opacity: 0.75, fog: true, depthWrite: false });
  mat.userData.fogReach = 1;
  const lines = new THREE.LineSegments(g, mat);
  lines.frustumCulled = false;
  lines.name = "alive_drips";
  ctx.scene.add(lines);
  // splashes: a point where each drop lands, for a moment
  const spos = new Float32Array(DROPS * 3);
  const sage = new Float32Array(DROPS);
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(spos, 3));
  sg.setAttribute("aAge", new THREE.BufferAttribute(sage, 1));
  const smat = pointMat({
    vertexShader: /* glsl */ `
      ${VCOMMON}
      attribute float aAge;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFogDepth = -mv.z;
        gl_Position = psxSnap(projectionMatrix * mv);
        gl_PointSize = clamp(pointPx(0.07 + aAge * 0.12, gl_Position), 1.0, 6.0);
        vA = aAge < 0.0 ? 0.0 : (1.0 - aAge);
        if (aAge < 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${FCOMMON}
      varying float vA;
      void main() {
        float f = fogK();
        gl_FragColor = vec4(mix(vec3(0.75, 0.8, 0.85), fogColor, f), vA * 0.6 * (1.0 - f));
      }`,
  });
  const splashes = new THREE.Points(sg, smat);
  splashes.frustumCulled = false;
  splashes.name = "alive_drip_splash";
  ctx.scene.add(splashes);

  interface Drop { x: number; y: number; z: number; v: number; ground: number; on: boolean; splash: number }
  const drops: Drop[] = Array.from({ length: DROPS }, () => ({ x: 0, y: 0, z: 0, v: 0, ground: 0, on: false, splash: -1 }));
  let eaves: Eave[] = [];
  let total = 0;
  const picked = new THREE.Vector3(1e9, 0, 0);
  let on = true;
  let flow = 0;
  let plink = 0;
  let wetSince = 0;

  /** The street eaves within 22 m: the front of a "side" roof, the cornice of a flat one. */
  function findEaves(f: Frame): Eave[] {
    const out: Eave[] = [];
    for (let i = 0; i < HOUSES.length; i++) {
      const h = HOUSES[i];
      if (!h.rect || !h.o || Math.abs(h.o[0] - f.eye.x) > 40 || Math.abs(h.o[1] - f.eye.z) > 40) continue;
      const r = roofOf(i);
      if (!r) continue;
      if (h.roof === "front") {
        // a gable to the street: the side slopes drain to the front corners (gutters, a spout)
        if (!h.street[0]) continue;
        for (const s of [h.s[0] + 0.25, h.s[1] - 0.25]) {
          const a = P(h, s - 0.2, h.t[0] - 0.12);
          const b = P(h, s + 0.2, h.t[0] - 0.12);
          if (Math.hypot(a[0] - f.eye.x, a[1] - f.eye.z) < 24) out.push({ a, b, y: r.H - 0.1 });
        }
        continue;
      }
      const [s0, s1] = h.s;
      const [t0, t1] = h.t;
      const over = h.alley ? 0.25 : 0.4;
      const drop = h.roof === "side" ? over * Math.tan(((h.alley ? 45 : h.pitch) * Math.PI) / 180) : 0;
      const sides: Array<[number, number]> = [];
      if (h.street[0]) sides.push([t0 - (h.roof === "side" ? over : 0.15), 0]);
      if (h.street[2]) sides.push([t1 + (h.roof === "side" ? over : 0.15), 2]);
      for (const [t] of sides) {
        const a = P(h, s0 + 0.2, t);
        const b = P(h, s1 - 0.2, t);
        const mx = (a[0] + b[0]) / 2;
        const mz = (a[1] + b[1]) / 2;
        if (Math.hypot(mx - f.eye.x, mz - f.eye.z) > 22 + Math.hypot(a[0] - b[0], a[1] - b[1]) / 2) continue;
        out.push({ a, b, y: r.H - drop - 0.05 });
      }
    }
    return out;
  }

  function update(f: Frame): void {
    if (!on) return;
    const dt = f.dt;
    // after the rain the eaves still run a while (the roofs drain): follows the wet ground
    if (f.rain > 0.05) wetSince = 0;
    else wetSince += dt;
    const after = f.wet > 0.2 ? Math.max(0, 1 - wetSince / 240) * 0.35 : 0;
    flow = Math.max(f.rain, after);
    const any = flow > 0.02 || drops.some((d) => d.on || d.splash >= 0);
    lines.visible = any;
    splashes.visible = any;
    if (!any) return;
    if (picked.distanceTo(f.eye) > 8) {
      eaves = findEaves(f);
      total = eaves.reduce((s, e) => s + Math.hypot(e.a[0] - e.b[0], e.a[1] - e.b[1]), 0);
      picked.copy(f.eye);
    }
    // new drops: so many a second per metre of eave, by the rain
    let born = eaves.length ? flow * total * 0.9 * dt : 0;
    for (let i = 0; i < DROPS && born > 0; i++) {
      const d = drops[i];
      if (d.on || d.splash >= 0) continue;
      if (born < 1 && Math.random() > born) break;
      born -= 1;
      // a place along the eaves (by length)
      let k = Math.random() * total;
      let e = eaves[0];
      for (const q of eaves) {
        const L = Math.hypot(q.a[0] - q.b[0], q.a[1] - q.b[1]);
        if (k <= L) {
          e = q;
          break;
        }
        k -= L;
      }
      const u = Math.random();
      d.x = e.a[0] + (e.b[0] - e.a[0]) * u;
      d.z = e.a[1] + (e.b[1] - e.a[1]) * u;
      if (Math.hypot(d.x - f.eye.x, d.z - f.eye.z) > 24) continue;
      d.y = e.y;
      d.v = 0;
      d.ground = ctx.world.baseAt(d.x, d.z);
      if (!Number.isFinite(d.ground)) d.ground = 0;
      d.on = true;
    }
    for (let i = 0; i < DROPS; i++) {
      const d = drops[i];
      if (d.on) {
        d.v += 9.8 * dt;
        d.y -= d.v * dt;
        if (d.y <= d.ground) {
          d.on = false;
          d.splash = 0;
          d.y = d.ground;
          if (plink <= 0 && Math.hypot(d.x - f.eye.x, d.z - f.eye.z) < 5) {
            plink = 0.08 + Math.random() * 0.2;
            ctx.sound()?.placed({ x: d.x, y: d.ground + 0.05, z: d.z }, { ref: 0.8, reach: 3, max: 5, rolloff: 1.3, gain: 0.8 }, drip());
          }
        }
      } else if (d.splash >= 0) {
        d.splash += dt / 0.18;
        if (d.splash >= 1) d.splash = -1;
      }
      // a streak as long as it fell in a frame and a half (at least 12 cm)
      const len = d.on ? Math.max(0.25, d.v * 0.035) : 0;
      const j = i * 6;
      if (d.on) {
        pos[j] = d.x; pos[j + 1] = d.y + len; pos[j + 2] = d.z;
        pos[j + 3] = d.x; pos[j + 4] = d.y; pos[j + 5] = d.z;
      } else {
        pos[j + 1] = -999; pos[j + 4] = -999;
      }
      spos.set([d.x, d.y + 0.02, d.z], i * 3);
      sage[i] = d.splash;
    }
    plink -= dt;
    g.attributes.position.needsUpdate = true;
    sg.attributes.position.needsUpdate = true;
    sg.attributes.aAge.needsUpdate = true;
  }
  return {
    name: "drips",
    update,
    info: () => ({ flow: +flow.toFixed(2), eaves: eaves.length, metres: +total.toFixed(1), falling: drops.filter((d) => d.on).length, first: eaves[0] ? [eaves[0].a, eaves[0].b, +eaves[0].y.toFixed(2)] : null }),
    setOn: (v) => {
      on = v;
      lines.visible = v;
      splashes.visible = v;
    },
  };
}

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
    uniforms: { uTint: tint },
    vertexShader: /* glsl */ `
      ${VCOMMON}
      attribute float aAge;
      attribute float aSize;
      varying float vA;
      varying float vS;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFogDepth = -mv.z;
        gl_Position = psxSnap(projectionMatrix * mv);
        gl_PointSize = clamp(pointPx((0.07 + aAge * 0.24) * aSize, gl_Position), 2.0, 90.0);
        vA = aAge < 0.0 ? 0.0 : smoothstep(0.0, 0.12, aAge) * (1.0 - aAge) * (0.7 + 0.3 * aSize);
        vS = position.x * 3.1 + position.z * 1.7;
        if (aAge < 0.0 || -mv.z < 0.12) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${FCOMMON}
      uniform vec3 uTint;
      varying float vA;
      varying float vS;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c) * 4.0;
        if (d > 1.0) discard;
        float mottle = 0.6 + 0.4 * hash12(floor(gl_PointCoord * 4.0) + vS);
        float a = vA * (1.0 - d) * (1.0 - d) * mottle * 0.2;
        if (a < 0.004) discard;
        gl_FragColor = vec4(mix(uTint, fogColor, fogK()), a);
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
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const bb = m.geometry.boundingBox!;
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
          // the nose: the front and low end of the body's box (the head hangs forward)
          head.set(0, bb.min.y + (bb.max.y - bb.min.y) * 0.66, bb.max.z - 0.3).applyMatrix4(m4);
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

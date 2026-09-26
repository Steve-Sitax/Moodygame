import * as THREE from "three";
import { psx, psxUniforms } from "../../retro/psx";
import { bilge, buoyBell } from "../../audio/aliveSounds";
import { FCOMMON, VCOMMON, hours, pointMat, srgb, type Ctx, type Frame, type Part } from "./common";

// M7 alive: the river's own life.
// - Buoys along the far edge of the fairway (below the lanes at z -84 and -100, clear of the liner at
//   anchor): red cans and black cones riding the waves, and two bell buoys whose bell strikes as they
//   roll (more in a sea; heard far over the water, dull in the fog). Buoys with bells or horns marked
//   the Scheldt's fairway for centuries (see M7-alive.md).
// - Ships' lights at night: a white riding light forward on the ships at anchor and moored in the
//   stream, and on the ships under way the white masthead light and the red (port) and green
//   (starboard) side lights of the 1863 rules. Glows only, seen far through the fog.
// - Bilge pumps: now and then a hand on a moored ship works the pump, and water gushes out of the
//   side in time with the clank of the brake.
// - Mist on the water at dawn and at dusk on a still day: low wisps lying on the river, the docks and
//   the canal, drifting with the air.

// ------------------------------------------------------------------ buoys

const BUOYS: Array<{ x: number; z: number; kind: "can" | "cone" | "bell" }> = [
  { x: -400, z: -118, kind: "cone" },
  { x: -300, z: -120, kind: "bell" },
  { x: -200, z: -117, kind: "can" },
  { x: -110, z: -120, kind: "cone" },
  { x: 120, z: -118, kind: "can" },
  { x: 210, z: -121, kind: "bell" },
  { x: 290, z: -117, kind: "cone" },
  // two mooring buoys off the Werf, clear of the moored rows (to z -20) and of the lanes (z -84)
  { x: -300, z: -42, kind: "can" },
  { x: -250, z: -44, kind: "can" },
];

function buoyGeometry(kind: "can" | "cone" | "bell"): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const paint = (g: THREE.BufferGeometry, c: number[]) => {
    const n = g.getAttribute("position").count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set(c, i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  const red = srgb(0.5, 0.13, 0.1);
  const black = srgb(0.08, 0.08, 0.09);
  const rust = srgb(0.3, 0.2, 0.15);
  const iron = srgb(0.16, 0.16, 0.17);
  const bronze = srgb(0.45, 0.36, 0.2);
  if (kind === "can") {
    const g = new THREE.CylinderGeometry(0.75, 0.85, 1.6, 8);
    g.translate(0, 0.55, 0);
    paint(g, red);
    const r = new THREE.CylinderGeometry(0.88, 0.88, 0.25, 8);
    r.translate(0, -0.2, 0);
    paint(r, rust);
  } else if (kind === "cone") {
    const g = new THREE.ConeGeometry(0.85, 2.0, 8);
    g.translate(0, 0.75, 0);
    paint(g, black);
    const r = new THREE.CylinderGeometry(0.9, 0.9, 0.3, 8);
    r.translate(0, -0.2, 0);
    paint(r, rust);
  } else {
    // a bell buoy: a squat black hull, a cage of four iron legs and the bell hung inside
    const hull = new THREE.CylinderGeometry(1.1, 0.9, 1.2, 8);
    hull.translate(0, 0.2, 0);
    paint(hull, black);
    const band = new THREE.CylinderGeometry(1.13, 1.13, 0.3, 8);
    band.translate(0, 0.55, 0);
    paint(band, red);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const leg = new THREE.BoxGeometry(0.09, 2.6, 0.09);
      leg.translate(0, 2.0, 0);
      leg.applyMatrix4(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), 0.22));
      leg.translate(Math.cos(a) * 0.75, 0, Math.sin(a) * 0.75);
      paint(leg, iron);
    }
    const cap = new THREE.CylinderGeometry(0.25, 0.25, 0.12, 6);
    cap.translate(0, 3.3, 0);
    paint(cap, iron);
    const bell = new THREE.CylinderGeometry(0.18, 0.36, 0.55, 8, 1, true);
    bell.translate(0, 2.85, 0);
    paint(bell, bronze);
  }
  const g = new THREE.BufferGeometry();
  // merge by hand (all non-indexed)
  const pos: number[] = [];
  const col: number[] = [];
  for (const p of parts) {
    pos.push(...(p.getAttribute("position").array as Float32Array));
    col.push(...(p.getAttribute("color").array as Float32Array));
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export function createBuoys(ctx: Ctx): Part {
  const mat = psx(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  const geos = { can: buoyGeometry("can"), cone: buoyGeometry("cone"), bell: buoyGeometry("bell") };
  const list = BUOYS.map((b, i) => {
    const m = new THREE.Mesh(geos[b.kind], mat);
    m.name = `alive_buoy_${b.kind}`;
    m.position.set(b.x, 0, b.z);
    ctx.scene.add(m);
    return { ...b, m, seed: i * 1.7, wait: 3 + Math.random() * 6, rung: 0 };
  });
  let on = true;
  let strikes = 0;

  function update(f: Frame): void {
    if (!on) return;
    const t = psxUniforms.uTime.value;
    const sea = psxUniforms.uSea.value;
    for (const b of list) {
      const y = ctx.world.waterLevel(b.x, b.z);
      const baseY = Number.isFinite(y) ? y : 0;
      // ride the waves: heave with the water, roll and pitch with its slope
      const dx = ctx.world.waterLevel(b.x + 1, b.z) - baseY;
      const dz = ctx.world.waterLevel(b.x, b.z + 1) - baseY;
      b.m.position.y = baseY - 0.25;
      const roll = THREE.MathUtils.clamp(-dx * 1.4 + Math.sin(t * 0.9 + b.seed) * 0.03 * sea, -0.4, 0.4);
      const pitch = THREE.MathUtils.clamp(dz * 1.4 + Math.cos(t * 0.7 + b.seed) * 0.03 * sea, -0.4, 0.4);
      b.m.rotation.set(pitch, b.seed, roll);
      if (b.kind !== "bell") continue;
      // the clapper swings with the roll: it strikes when she rolls hard (a storm: often)
      b.wait -= f.dt;
      const lean = Math.hypot(roll, pitch);
      if (b.wait <= 0 && lean > 0.02) {
        b.wait = (6 + Math.random() * 10) / Math.max(0.8, sea);
        const n = 1 + Math.floor(Math.random() * Math.min(4, 1 + sea));
        if (ctx.sound()?.placed({ x: b.x, y: baseY + 2.8, z: b.z }, { ref: 8, reach: 250, max: 650, occl: 0, wet: 0.6 }, buoyBell(n))) strikes += n;
      }
    }
  }
  return {
    name: "buoys",
    update,
    info: () => ({ buoys: list.length, strikes, at: list.map((b) => [b.x, b.z, b.kind]) }),
    setOn: (v) => {
      on = v;
      for (const b of list) b.m.visible = v;
    },
  };
}

// ------------------------------------------------------------------ ships' lights

/** Ships lying still in the stream (world/rijnkaai.ts put() and the brig): x, z, yaw, length. */
const RIDING: Array<[number, number, number, number]> = [
  [-40, -7.2, Math.PI / 2, 26],
  [-34, -26, Math.PI / 2, 34],
  [-150, -62, Math.PI / 2, 40],
  [-40, -48, Math.PI / 2, 34],
  [110, -44, -Math.PI / 2, 34],
  [-205, -64, Math.PI / 2 + 0.3, 24],
  [30, -70, 1.2, 14],
  [125, 80, 0, 34],
];
const MAX_LIGHTS = 64;

export function createShipLights(ctx: Ctx): Part {
  const pos = new Float32Array(MAX_LIGHTS * 3);
  const col = new Float32Array(MAX_LIGHTS * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aCol", new THREE.BufferAttribute(col, 3));
  g.setDrawRange(0, 0);
  const lit = { value: 0 };
  const mat = pointMat({
    additive: true,
    fogReach: 3,
    uniforms: { uLit: lit },
    vertexShader: /* glsl */ `
      ${VCOMMON}
      attribute vec3 aCol;
      uniform float uLit;
      varying vec3 vCol;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFogDepth = -mv.z;
        gl_Position = psxSnap(projectionMatrix * mv);
        // a lantern and its halo in the wet air: bigger far off than its size (the fog spreads it)
        gl_PointSize = clamp(pointPx(0.9, gl_Position), 3.0, 22.0);
        vCol = aCol * uLit * (0.9 + 0.1 * sin(uTime * 7.0 + position.x));
      }`,
    fragmentShader: /* glsl */ `
      ${FCOMMON}
      varying vec3 vCol;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c) * 2.0;
        if (d > 1.0) discard;
        float core = smoothstep(0.35, 0.0, d);
        float halo = (1.0 - d) * 0.35;
        // a lantern shows through much more fog than a hull: three fog lengths
        float f = smoothstep(fogNear, fogFar * 3.0, vFogDepth);
        gl_FragColor = vec4(vCol * (core + halo) * (1.0 - f), 1.0);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.name = "alive_ship_lights";
  pts.renderOrder = 3;
  ctx.scene.add(pts);
  let on = true;
  let n = 0;
  const W = [1, 0.92, 0.75];
  const RED = [1, 0.15, 0.08];
  const GREEN = [0.2, 1, 0.35];
  const put = (x: number, y: number, z: number, c: number[]) => {
    if (n >= MAX_LIGHTS) return;
    pos.set([x, y, z], n * 3);
    col.set(c, n * 3);
    n++;
  };

  function update(f: Frame): void {
    if (!on) return;
    lit.value += ((f.night > 0.55 || (f.weather === "fog" && f.night > 0.25) ? 1 : 0) - lit.value) * Math.min(1, f.dt);
    pts.visible = lit.value > 0.01;
    if (!pts.visible) return;
    n = 0;
    const lvl = (x: number, z: number) => {
      const y = ctx.world.waterLevel(x, z);
      return Number.isFinite(y) ? y : 0;
    };
    // at anchor and moored in the stream: one white light forward, 6 m up on the forestay
    for (const [x, z, yaw, len] of RIDING) {
      const fx = x + Math.sin(yaw) * len * 0.4;
      const fz = z + Math.cos(yaw) * len * 0.4;
      put(fx, lvl(fx, fz) + (len > 20 ? 6.5 : 3.5), fz, W);
    }
    // under way: masthead white, port red, starboard green (the liner at anchor: two white)
    const boats = ctx.world.boats();
    for (const s of boats?.moving() ?? []) {
      const yaw = s.heading ?? 0;
      const fwd = [Math.sin(yaw), Math.cos(yaw)];
      const port = [Math.cos(yaw), -Math.sin(yaw)];
      let L = 20, B = 6;
      try {
        const d = boats!.dims(s.kind as Parameters<NonNullable<typeof boats>["dims"]>[0]);
        L = d.length;
        B = d.beam;
      } catch {
        /* an unknown kind: a middling ship */
      }
      const y0 = lvl(s.x, s.z);
      if (s.anchored) {
        put(s.x + fwd[0] * L * 0.45, y0 + 12, s.z + fwd[1] * L * 0.45, W);
        put(s.x - fwd[0] * L * 0.45, y0 + 8, s.z - fwd[1] * L * 0.45, W);
        continue;
      }
      if (s.speed <= 0.05) continue;
      const big = L > 18;
      if (s.steam || big) put(s.x + fwd[0] * L * 0.25, y0 + (big ? 9 : 5), s.z + fwd[1] * L * 0.25, W);
      const sx = s.x + fwd[0] * L * 0.1;
      const sz = s.z + fwd[1] * L * 0.1;
      put(sx + port[0] * B * 0.5, y0 + (big ? 3.5 : 2), sz + port[1] * B * 0.5, RED);
      put(sx - port[0] * B * 0.5, y0 + (big ? 3.5 : 2), sz - port[1] * B * 0.5, GREEN);
    }
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = true;
    g.attributes.aCol.needsUpdate = true;
  }
  return {
    name: "shipLights",
    update,
    info: () => ({ lights: n, lit: +lit.value.toFixed(2) }),
    setOn: (v) => {
      on = v;
      pts.visible = v;
    },
  };
}

// ------------------------------------------------------------------ bilge pumps

/**
 * Moored ships with a pump: middle, yaw, half beam and the outlet's height over her origin (measured on
 * boats.glb: the widest point of the hull, just under the rail), and which side (1 port, -1 starboard).
 */
const PUMPS: Array<{ x: number; z: number; yaw: number; half: number; free: number; side: 1 | -1 }> = [
  { x: -40, z: -7.2, yaw: Math.PI / 2, half: 4.8, free: 2.3, side: -1 },
  { x: -34, z: -26, yaw: Math.PI / 2, half: 5.0, free: 2.0, side: -1 },
  { x: 110, z: -44, yaw: -Math.PI / 2, half: 5.0, free: 2.0, side: 1 },
  { x: 125, z: 80, yaw: 0, half: 5.0, free: 2.0, side: 1 },
  { x: -150, z: -62, yaw: Math.PI / 2, half: 4.5, free: 3.0, side: -1 },
];
const PER_PUMP = 40;

export function createBilge(ctx: Ctx): Part {
  const N = PUMPS.length * PER_PUMP;
  const pos = new Float32Array(N * 3);
  const age = new Float32Array(N);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aAge", new THREE.BufferAttribute(age, 1));
  const mat = pointMat({
    vertexShader: /* glsl */ `
      ${VCOMMON}
      attribute float aAge;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFogDepth = -mv.z;
        gl_Position = psxSnap(projectionMatrix * mv);
        gl_PointSize = clamp(pointPx(0.11, gl_Position), 1.0, 8.0);
        vA = aAge < 0.0 ? 0.0 : 0.75;
        if (aAge < 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${FCOMMON}
      varying float vA;
      void main() {
        float f = fogK();
        // dirty bilge water: brownish grey, catching the light
        gl_FragColor = vec4(mix(vec3(0.55, 0.53, 0.46), fogColor, f), vA * (1.0 - f));
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.name = "alive_bilge";
  ctx.scene.add(pts);
  interface Drop { p: THREE.Vector3; v: THREE.Vector3; on: boolean }
  const drops: Drop[] = Array.from({ length: N }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), on: false }));
  const state = PUMPS.map((_, i) => ({ strokes: 0, clock: 0, wait: 20 + i * 37 + Math.random() * 60, soundAt: 0 }));
  const PERIOD = 1.7;
  let on = true;
  let working = 0;

  /** Each pump's ship as placed (rijnkaai.ts: a group at her middle that rides the tide). */
  const hulls: Array<THREE.Object3D | null> = PUMPS.map(() => null);
  const hullOf = (i: number) => {
    const p = PUMPS[i];
    hulls[i] ??= ctx.scene.children.find((o) => Math.abs(o.position.x - p.x) < 0.5 && Math.abs(o.position.z - p.z) < 0.5 && o.name !== "" && !o.name.startsWith("alive")) ?? null;
    return hulls[i];
  };
  /** The outlet on the hull's side, just under the rail. */
  const outlet = (i: number, out: THREE.Vector3) => {
    const p = PUMPS[i];
    const side = [Math.cos(p.yaw) * p.side, -Math.sin(p.yaw) * p.side];
    const h = hullOf(i);
    const y = (h ? h.position.y : ctx.world.waterLevel(p.x, p.z)) + p.free;
    return out.set(p.x + side[0] * (p.half + 0.05), y, p.z + side[1] * (p.half + 0.05));
  };
  const o = new THREE.Vector3();

  function update(f: Frame): void {
    if (!on) return;
    const dt = f.dt;
    working = 0;
    for (let i = 0; i < PUMPS.length; i++) {
      const s = state[i];
      const near = Math.hypot(PUMPS[i].x - f.eye.x, PUMPS[i].z - f.eye.z) < 90;
      if (s.strokes <= 0) {
        s.wait -= dt;
        if (s.wait <= 0 && near && f.night < 0.9) {
          s.strokes = 14 + Math.floor(Math.random() * 20);
          s.clock = 0;
          s.soundAt = 0;
        }
        continue;
      }
      working++;
      s.clock += dt;
      const phase = (s.clock % PERIOD) / PERIOD;
      outlet(i, o);
      const side = [Math.cos(PUMPS[i].yaw) * PUMPS[i].side, -Math.sin(PUMPS[i].yaw) * PUMPS[i].side];
      // water comes on the down stroke (the second half of each stroke)
      if (phase > 0.4 && phase < 0.8) {
        for (let k = 0; k < 3; k++) {
          const j = i * PER_PUMP + Math.floor(Math.random() * PER_PUMP);
          const d = drops[j];
          if (d.on) continue;
          d.on = true;
          d.p.copy(o).add(new THREE.Vector3((Math.random() - 0.5) * 0.06, 0, (Math.random() - 0.5) * 0.06));
          const sp = 1.2 + Math.random() * 0.6;
          d.v.set(side[0] * sp, 0.1 + Math.random() * 0.2, side[1] * sp);
        }
      }
      if (s.clock >= s.soundAt) {
        // the sound in runs of six strokes (the clank carries ~40 m, the gush less)
        s.soundAt = s.clock + PERIOD * 6;
        ctx.sound()?.placed({ x: o.x, y: o.y, z: o.z }, { ref: 2, reach: 25, max: 45 }, bilge(6, PERIOD));
      }
      if (s.clock > s.strokes * PERIOD) {
        s.strokes = 0;
        s.wait = 90 + Math.random() * 200;
      }
    }
    for (let j = 0; j < N; j++) {
      const d = drops[j];
      if (!d.on) {
        age[j] = -1;
        continue;
      }
      d.v.y -= 9.8 * dt;
      d.p.addScaledVector(d.v, dt);
      const wl = ctx.world.waterLevel(d.p.x, d.p.z);
      if (d.p.y < (Number.isFinite(wl) ? wl : -2)) d.on = false;
      pos.set([d.p.x, d.p.y, d.p.z], j * 3);
      age[j] = d.on ? 1 : -1;
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.aAge.needsUpdate = true;
  }
  return {
    name: "bilge",
    update,
    info: () => ({ working, pumps: PUMPS.length }),
    setOn: (v) => {
      on = v;
      pts.visible = v;
    },
    // dev: every pump near Jef works now
    ...{ pumpNow: () => state.forEach((s) => (s.wait = 0)) },
  } as Part;
}

// ------------------------------------------------------------------ mist on the water

const WISPS = 70;

export function createMist(ctx: Ctx): Part {
  const pos = new Float32Array(WISPS * 3);
  const data = new Float32Array(WISPS * 2); // life 0..1 (-1 off), size
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aData", new THREE.BufferAttribute(data, 2));
  const amt = { value: 0 };
  const tint = { value: new THREE.Color() };
  const mat = pointMat({
    fogReach: 1.2,
    uniforms: { uAmt: amt, uTint: tint },
    vertexShader: /* glsl */ `
      ${VCOMMON}
      attribute vec2 aData;
      uniform float uAmt;
      varying float vA;
      varying float vSeed;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFogDepth = -mv.z;
        gl_Position = psxSnap(projectionMatrix * mv);
        gl_PointSize = clamp(pointPx(aData.y, gl_Position), 2.0, 140.0);
        float life = aData.x;
        // (faded out close by: a wisp you are in is the air itself)
        vA = life < 0.0 ? 0.0 : uAmt * sin(3.14159 * life) * smoothstep(3.0, 9.0, -mv.z);
        vSeed = position.x * 0.37 + position.z * 0.11;
        if (vA < 0.004 || -mv.z < 1.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${FCOMMON}
      uniform vec3 uTint;
      varying float vA;
      varying float vSeed;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        // flat and long: mist lies along the water
        c.y *= 2.2;
        float d = dot(c, c) * 4.0;
        if (d > 1.0) discard;
        float mottle = 0.6 + 0.4 * hash12(floor(gl_PointCoord * 6.0) + vSeed);
        float a = vA * (1.0 - d) * (1.0 - d) * mottle * 0.34;
        if (a < 0.004) discard;
        gl_FragColor = vec4(mix(uTint, fogColor, fogK() * 0.7), a);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.name = "alive_river_mist";
  pts.renderOrder = 2;
  ctx.scene.add(pts);
  interface Wisp { p: THREE.Vector3; life: number; speed: number; size: number }
  const wisps: Wisp[] = Array.from({ length: WISPS }, () => ({ p: new THREE.Vector3(), life: -1, speed: 0, size: 4 }));
  let on = true;
  const w2 = new THREE.Vector2();

  function spawn(w: Wisp, f: Frame): void {
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = 6 + Math.sqrt(Math.random()) * 70;
      const x = f.eye.x + Math.cos(a) * d;
      const z = f.eye.z + Math.sin(a) * d;
      if (!ctx.world.isWater(x, z) || !ctx.world.swimFree(x, z, 3)) continue;
      const y = ctx.world.waterLevel(x, z);
      if (!Number.isFinite(y)) continue;
      w.p.set(x, y + 0.25 + Math.random() * 0.9, z);
      w.life = 0;
      w.speed = 1 / (25 + Math.random() * 25);
      w.size = 3 + Math.random() * 5;
      return;
    }
    w.life = -1;
  }

  function update(f: Frame): void {
    if (!on) return;
    // dawn is the time for it, dusk a little; a fog day all day; not in rain or wind
    const when = Math.max(hours(f.hour, 4.3, 9.8, 1.8), 0.55 * hours(f.hour, 17.2, 23, 1.5), f.weather === "fog" ? 0.6 : 0);
    const byWeather = f.weather === "rain" || f.weather === "storm" ? 0 : f.weather === "clear" ? 0.8 + 0.2 * f.cold : 1;
    const target = when * byWeather * THREE.MathUtils.clamp(1.4 - ctx.wind.speed * 0.6, 0, 1) * (1 - Math.min(1, f.rain * 3));
    amt.value += (target - amt.value) * Math.min(1, f.dt * 0.2);
    // mist is paler than the air by day, and a dim grey-blue by night
    const fog = ctx.scene.fog as THREE.Fog | null;
    if (fog) tint.value.copy(fog.color).lerp(new THREE.Color(0.85, 0.87, 0.9), 0.35 * (1 - f.night));
    pts.visible = amt.value > 0.01;
    if (!pts.visible) return;
    for (let i = 0; i < WISPS; i++) {
      const w = wisps[i];
      if (w.life < 0 || w.life >= 1 || Math.hypot(w.p.x - f.eye.x, w.p.z - f.eye.z) > 85) spawn(w, f);
      else {
        w.life += f.dt * w.speed;
        ctx.wind.at(w.p.x, w.p.z, w2);
        w.p.x += w2.x * 0.35 * f.dt;
        w.p.z += w2.y * 0.35 * f.dt;
      }
      pos.set([w.p.x, w.p.y, w.p.z], i * 3);
      data[i * 2] = w.life;
      data[i * 2 + 1] = w.size;
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.aData.needsUpdate = true;
  }
  return {
    name: "mist",
    update,
    info: () => ({ amount: +amt.value.toFixed(2), live: wisps.filter((w) => w.life >= 0).length }),
    setOn: (v) => {
      on = v;
      pts.visible = v;
    },
  };
}

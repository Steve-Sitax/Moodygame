import * as THREE from "three";

// The sky (picture round 2026-09-26, package 4: "the game's sky is flat fog colour"). A dome over the town that is
// not the flat colour of the air: a low grey autumn overcast, darker cloud masses and a few lighter breaks, drifting
// with the wind (the same wind the chimney smoke bends in: world/ambient.ts). The mean stays the air's own colour, so
// the grime and the dim of the grime pass stay: the clouds only move light about, they add none. At the horizon it
// fades into the fog colour, so the far houses, the far bank and the fog still meet the sky without a seam.
// - Rain and storm: a lower, darker, closed deck, and it drives faster.
// - Dusk (a clear or misty evening): a warm band low where the evening sun goes down (the golden hour's low sun,
//   rijnkaai.ts SUN_LOW), the undersides of the clouds lit over it; at dawn a cold band on the other side.
// - Night: black cloud, a faint brown glow on the undersides from the town's gas; on a clear night a few stars in
//   the gaps.
// Made in the shader (value noise, no picture): one draw call, a 16 x 8 sphere. Pixelated in direction steps, as the
// PS1 drew its skies: blocky cloud edges, no smooth gradients. Fog false: it does its own horizon.

const V = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // (on the far plane's inside: never in front of anything)
  gl_Position.z = gl_Position.w * 0.99999;
}`;

const F = /* glsl */ `
uniform vec3 uAir;
uniform vec2 uDrift;
uniform float uCover;
uniform float uDark;
uniform float uNight;
uniform float uStars;
uniform float uWarm;
uniform float uCold;
uniform vec3 uWarmCol;
uniform vec3 uColdCol;
uniform vec2 uSunXZ;
uniform float uTime;
varying vec3 vDir;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  // the PS1 sky: the direction in coarse steps (about a third of a degree), so the cloud edges are blocky
  d = normalize(floor(d * 180.0 + 0.5) / 180.0);
  float e = d.y;
  // the cloud deck: a plane over the town, seen in perspective (the clouds bunch up toward the horizon)
  vec2 p = d.xz / (max(e, 0.0) + 0.09) * 1.6;
  vec2 q = p + uDrift;
  float n = fbm(q * 0.4);
  // big slow masses and the breaks between them
  float mass = fbm(q * 0.16 + vec2(3.7, 1.9));
  float c = clamp(n * 0.55 + mass * 0.75 - 0.08, 0.0, 1.0);
  float dens = smoothstep(1.0 - uCover - 0.25, 1.0 - uCover + 0.25, c);
  // underside shading: thick cloud is darker, thin cloud and the breaks lighter; tuned so the mean stays ~1
  float shade = mix(1.3, 0.74, dens) - 0.16 * smoothstep(0.55, 0.95, c) * dens + 0.1 * (n - 0.5);
  shade = mix(shade, shade * 0.82, uDark);
  vec3 col = uAir * shade;
  // the evening's warm band where the sun goes down, lighting the undersides over it; the dawn's cold band opposite
  vec2 hz = normalize(d.xz + 1e-5);
  float toSun = max(0.0, dot(hz, uSunXZ));
  float band = pow(toSun, 3.0) * (1.0 - smoothstep(0.02, 0.5, e));
  col += uWarmCol * uWarm * band * (0.6 + 0.6 * smoothstep(0.35, 0.75, n)) * (0.5 + 0.8 * (1.0 - dens));
  float away = pow(max(0.0, -dot(hz, uSunXZ)), 2.0) * (1.0 - smoothstep(0.02, 0.4, e));
  col = mix(col, col * 0.75 + uColdCol, uCold * away * 0.8);
  // night: the gas of the town on the undersides, low all round
  col += vec3(0.022, 0.014, 0.007) * uNight * dens * (1.0 - smoothstep(0.0, 0.5, e));
  // stars through the gaps on a clear night
  if (uStars > 0.0) {
    vec2 sc = floor(d.xz / (e + 0.25) * 150.0);
    float st = h21(sc + 7.3);
    float tw = 0.7 + 0.3 * sin(uTime * (2.0 + st * 5.0) + st * 40.0);
    col += vec3(0.8, 0.82, 0.9) * step(0.998, st) * (1.0 - dens) * uStars * smoothstep(0.15, 0.4, e) * tw * 0.5;
  }
  // into the air at the horizon: the far fog and the sky meet without a seam (the dusk's band goes on down to it,
  // the air under it takes a little of its warmth)
  float hor = smoothstep(0.015, 0.3, e);
  vec3 air = uAir + uWarmCol * uWarm * pow(toSun, 2.5) * 0.35;
  air = mix(air, air * 0.8 + uColdCol * 0.5, uCold * away * 0.6);
  gl_FragColor = vec4(mix(air, col, hor), 1.0);
  #include <colorspace_fragment>
}`;

export interface CloudSky {
  mesh: THREE.Mesh;
  /**
   * Once a frame, after the air's colour is set. `air` the fog colour now, `hour` 0-24, `weather` the day's,
   * `clear` 0..1 the clear-sky weight (eased), `sunXZ` the low sun's direction on the ground plan.
   */
  update(dt: number, t: number, air: THREE.Color, hour: number, weather: string, clear: number, sunXZ: THREE.Vector2): void;
  info(): Record<string, number>;
}

/** Cloud cover and darkness by weather (cover 0..1, dark 0..1), and how fast it drives (m/s-ish, as the smoke's wind). */
const DECK: Record<string, [number, number, number]> = {
  fog: [0.72, 0.15, 0.35],
  mist: [0.62, 0.1, 0.6],
  clear: [0.5, 0.0, 0.9],
  rain: [0.9, 0.7, 1.5],
  storm: [0.97, 1.0, 3.2],
};

const bump = (h: number, a: number, p0: number, p1: number, b: number) =>
  h <= a || h >= b ? 0 : h < p0 ? THREE.MathUtils.smoothstep(h, a, p0) : h <= p1 ? 1 : 1 - THREE.MathUtils.smoothstep(h, p1, b);

export function createCloudSky(radius = 560): CloudSky {
  const U = {
    uAir: { value: new THREE.Color() },
    uDrift: { value: new THREE.Vector2() },
    uCover: { value: 0.7 },
    uDark: { value: 0 },
    uNight: { value: 0 },
    uStars: { value: 0 },
    uWarm: { value: 0 },
    uCold: { value: 0 },
    uWarmCol: { value: new THREE.Color(0.36, 0.14, 0.045) },
    uColdCol: { value: new THREE.Color(0.05, 0.07, 0.1) },
    uSunXZ: { value: new THREE.Vector2(-1, 0) },
    uTime: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: V, fragmentShader: F, side: THREE.BackSide, depthWrite: false, fog: false });
  mat.name = "cloud_sky";
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 8), mat);
  mesh.name = "cloud_sky";
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  const cur = { cover: 0.7, dark: 0, speed: 0.4 };
  const drift = new THREE.Vector2();
  function update(dt: number, t: number, air: THREE.Color, hour: number, weather: string, clear: number, sunXZ: THREE.Vector2): void {
    const [cv, dk, sp] = DECK[weather] ?? DECK.fog;
    const k = Math.min(1, dt * 0.3);
    cur.cover += (cv - cur.cover) * k;
    cur.dark += (dk - cur.dark) * k;
    cur.speed += (sp - cur.speed) * k;
    // the smoke's wind (ambient.ts): the same slow veer, so the clouds and the plumes go the same way
    const wa = 0.35 + Math.sin(t * 0.013) * 0.25;
    // (the deck is high: the drift in deck units is slow, a cloud crosses the sky in some minutes)
    drift.x += Math.cos(wa) * cur.speed * dt * 0.012;
    drift.y += Math.sin(wa) * cur.speed * dt * 0.012;
    U.uDrift.value.copy(drift);
    U.uAir.value.copy(air);
    U.uCover.value = cur.cover;
    U.uDark.value = cur.dark;
    U.uTime.value = t;
    const night = 1 - THREE.MathUtils.smoothstep(hour, 5.2, 7.2) + THREE.MathUtils.smoothstep(hour, 18.2, 20.0);
    U.uNight.value = THREE.MathUtils.clamp(night, 0, 1);
    U.uStars.value = THREE.MathUtils.clamp(night, 0, 1) * clear * (1 - cur.dark);
    // a clear or a misty evening: the warm band (fog and rain close it off)
    const open = Math.max(clear, weather === "mist" ? 0.45 : weather === "fog" ? 0.15 : 0);
    U.uWarm.value = bump(hour, 16.2, 17.3, 18.3, 19.1) * open * (1 - cur.dark * 0.8);
    U.uCold.value = bump(hour, 5.4, 6.4, 7.4, 8.6) * open * (1 - cur.dark * 0.8);
    if (sunXZ.lengthSq() > 1e-6) U.uSunXZ.value.copy(sunXZ).normalize();
  }
  return {
    mesh,
    update,
    info: () => ({ cover: +cur.cover.toFixed(2), dark: +cur.dark.toFixed(2), warm: +U.uWarm.value.toFixed(2), cold: +U.uCold.value.toFixed(2), stars: +U.uStars.value.toFixed(2), night: +U.uNight.value.toFixed(2) }),
  };
}
